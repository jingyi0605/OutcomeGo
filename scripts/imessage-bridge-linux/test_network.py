"""Fast validation tests for the private endpoint routing boundary."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('computer_network', ROOT / 'docker/outcomego-computer-network.py')
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'bridge.json'
        override = patch.object(network, 'HOST_BRIDGE_CONFIG', self.path)
        override.start()
        self.addCleanup(override.stop)
        model_override = patch.object(network, 'MODEL_CONFIG', self.path.with_name('models.json'))
        model_override.start()
        self.addCleanup(model_override.stop)

    def configure(self, endpoint, token='fixture-token'):
        self.path.write_text(json.dumps({'endpoint': endpoint, 'token': token}))
        self.path.chmod(0o600)

    def configure_models(self, *endpoints):
        self.model_path = network.MODEL_CONFIG
        self.model_path.write_text(json.dumps({
            'providers': {
                str(index): {'baseUrl': endpoint}
                for index, endpoint in enumerate(endpoints)
            }
        }))
        self.model_path.chmod(0o600)

    def test_numeric_endpoints_and_ports(self):
        for endpoint, expected in [
            ('http://172.18.0.1:8799/mcp', ('-4', '172.18.0.1', '8799')),
            ('https://192.0.2.2/mcp', ('-4', '192.0.2.2', '443')),
            ('http://192.0.2.2/mcp', ('-4', '192.0.2.2', '80')),
            ('http://[fd75::2]:8800/mcp', ('-6', 'fd75::2', '8800')),
            ('http://[::ffff:172.18.0.1]:8799/mcp', ('-4', '172.18.0.1', '8799')),
        ]:
            with self.subTest(endpoint=endpoint):
                self.configure(endpoint)
                self.assertEqual(network.host_bridge_endpoint(), expected)

    def test_invalid_endpoint_never_reserves_a_route(self):
        for endpoint in [
            'http://172.18.0.1:0/mcp', 'http://172.18.0.1:65536/mcp',
            'http://user:password@172.18.0.1:8799/mcp',
            'http://172.18.0.1:8799/mcp?token=value', 'http://172.18.0.1:8799/mcp#value',
            'file:///etc/passwd', 'ftp://172.18.0.1:8799/mcp',
            'http://bridge.example:8799/mcp', 'http://[fe80::1%25eth0]:8799/mcp',
            'http://0.0.0.0:8799/mcp', 'http://224.0.0.1:8799/mcp',
            'http://[::]:8799/mcp', 'http://[ff02::1]:8799/mcp',
        ]:
            with self.subTest(endpoint=endpoint):
                self.configure(endpoint)
                self.assertIsNone(network.host_bridge_endpoint())

    def test_missing_empty_or_invalid_token(self):
        for token in ['', ' ', None, True, 123]:
            with self.subTest(token=token):
                self.configure('http://172.18.0.1:8799/mcp', token)
                self.assertIsNone(network.host_bridge_endpoint())

    def test_missing_malformed_oversized_and_nonobject_files(self):
        self.assertIsNone(network.host_bridge_endpoint())
        for raw in ['{', '[]', 'null', 'false', '{}', '"text"', 'x' * 16385,
                    '[' * 1100 + '0' + ']' * 1100]:
            with self.subTest(raw=raw[:20]):
                self.path.write_text(raw)
                self.path.chmod(0o600)
                self.assertIsNone(network.host_bridge_endpoint())
        self.path.write_bytes(b'\xff')
        self.assertIsNone(network.host_bridge_endpoint())

    def test_permissions_symlinks_directories_and_fifos(self):
        self.configure('http://172.18.0.1:8799/mcp')
        self.path.chmod(0o644)
        self.assertIsNone(network.host_bridge_endpoint())
        self.path.chmod(0o600)
        target = self.path.with_suffix('.target')
        self.path.rename(target)
        self.path.symlink_to(target)
        self.assertIsNone(network.host_bridge_endpoint())
        self.path.unlink()
        self.path.mkdir(mode=0o700)
        self.assertIsNone(network.host_bridge_endpoint())
        self.path.rmdir()
        os.mkfifo(self.path, 0o600)
        self.assertIsNone(network.host_bridge_endpoint())

    def test_model_endpoints_reserve_only_literal_private_addresses(self):
        self.configure_models(
            'http://10.255.0.83:3425/v1',
            'https://172.18.0.1/v1',
            'https://api.example.com/v1',
            'https://8.8.8.8:443/v1',
        )
        self.assertEqual(
            network.model_endpoints(),
            {('-4', '10.255.0.83', '3425'), ('-4', '172.18.0.1', '443')},
        )

    def test_policy_modes_validate_private_rules(self):
        self.assertEqual(
            network.policy_value({
                'mode': 'allowlist',
                'rules': [{'address': '10.255.0.83', 'port': 3425}],
            }),
            {'mode': 'allowlist', 'rules': [('-4', '10.255.0.83', '3425')]},
        )
        with self.assertRaises(ValueError):
            network.policy_value({
                'mode': 'allowlist',
                'rules': [{'address': '8.8.8.8', 'port': 443}],
            })
        with self.assertRaises(ValueError):
            network.policy_value({
                'mode': 'invalid',
                'rules': [{'address': '10.0.0.2', 'port': 0}],
            })
        self.assertEqual(
            network.policy_value({'mode': 'managed', 'rules': []}),
            {'mode': 'allowlist', 'rules': []},
        )


class ReversePathTests(unittest.TestCase):
    """Internet replies must pass reverse-path validation whatever rp_filter is.

    Docker can reset rp_filter shortly after start. Unmarked, the validation
    lookup falls into the exit table (unreachable by default) and drops replies
    from public addresses while LAN keeps working.
    """

    def test_ruleset_marks_inbound_replies_before_routing(self):
        rules = network.nft_ruleset(8788, 8790)
        self.assertRegex(
            rules,
            r'chain rpf \{\s*type filter hook prerouting priority -150;[^}]*'
            r'iifname "eth0" meta mark set ' + network.MARK,
        )

    def test_ruleset_keeps_outbound_policy(self):
        rules = network.nft_ruleset(8788, 8790)
        for expected in ['chain transport', 'chain enforce', 'chain forwarding',
                         'ct direction reply meta mark set ' + network.MARK]:
            self.assertIn(expected, rules)

    def test_sysctls_do_not_rely_on_rp_filter_alone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['all', 'default', 'eth0']:
                (root / name).mkdir()
                (root / name / 'rp_filter').write_text('2')
                (root / name / 'src_valid_mark').write_text('0')
            network.disable_reverse_path_filter(root)
            for name in ['all', 'default', 'eth0']:
                self.assertEqual((root / name / 'rp_filter').read_text(), '0')
                self.assertEqual((root / name / 'src_valid_mark').read_text(), '1')

    def test_connected_prefixes_cover_the_bridge_but_not_the_tunnel(self):
        routes = json.dumps([
            {'dst': '172.19.0.0/16', 'dev': 'eth0'},
            {'dst': '198.18.0.0/15', 'dev': network.TUN},
            {'dst': '169.254.0.0/16', 'dev': 'eth0'},
            {'dst': 'default', 'dev': 'eth0'},
        ])
        with patch.object(network, 'run', return_value=routes):
            self.assertEqual(network.connected_prefixes('-4'), ['172.19.0.0/16'])


if __name__ == '__main__':
    unittest.main()
