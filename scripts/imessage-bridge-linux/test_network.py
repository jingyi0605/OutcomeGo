"""Fast validation tests for the private endpoint routing boundary."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import contextmanager, nullcontext
from types import SimpleNamespace
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
            {'mode': 'allowlist', 'rules': [('-4', '10.255.0.83', 3425, 3425)]},
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

    def test_policy_accepts_private_subnets_and_port_ranges(self):
        self.assertEqual(
            network.policy_value({
                'mode': 'allowlist',
                'rules': [
                    {'address': '10.255.0.17/24', 'port': '8000-8100'},
                    {'address': 'fd75::1234/64', 'port': 443},
                ],
            }),
            {'mode': 'allowlist', 'rules': [
                ('-4', '10.255.0.0/24', 8000, 8100),
                ('-6', 'fd75::/64', 443, 443),
            ]},
        )

    def test_policy_rejects_public_or_invalid_subnets_and_port_ranges(self):
        for address, port in [
            ('10.0.0.0/7', 80), ('192.168.0.0/15', 80), ('fd00::/6', 80),
            ('10.0.0.0/33', 80), ('10.0.0.0/255.0.255.0', 80),
            ('10.0.0.1', '0-80'), ('10.0.0.1', '81-80'), ('10.0.0.1', '80-65536'),
        ]:
            with self.subTest(address=address, port=port):
                with self.assertRaises(ValueError):
                    network.policy_value({'mode': 'allowlist', 'rules': [{'address': address, 'port': port}]})


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

    def test_ruleset_clears_worker_transport_mark_before_private_allow_rules(self):
        rules = network.nft_ruleset(8788, 8790)
        clear_v4 = 'ct direction original ip daddr { ' + ', '.join(network.PRIVATE_V4) + ' } meta l4proto tcp meta mark set 0'
        clear_v6 = 'ct direction original ip6 daddr { ' + ', '.join(network.PRIVATE_V6) + ' } meta l4proto tcp meta mark set 0'
        self.assertIn(clear_v4, rules)
        self.assertIn(clear_v6, rules)
        self.assertLess(rules.index(clear_v4), rules.index('jump manual_policy_v4'))
        self.assertLess(rules.index(clear_v6), rules.index('jump manual_policy_v6'))

    def test_unlisted_private_tcp_is_rejected_before_tunnel_accept(self):
        rules = network.nft_ruleset(8788, 8790)
        for protocol, prefixes in [('ip', network.PRIVATE_V4), ('ip6', network.PRIVATE_V6)]:
            reject = (protocol + ' daddr { ' + ', '.join(prefixes) +
                      ' } meta l4proto tcp counter reject with icmpx type admin-prohibited')
            self.assertGreater(rules.index(reject), rules.index('meta mark & 0xffff == ' + network.MARK + ' accept'))
            self.assertLess(rules.index(reject), rules.index('oifname "outcomego0" meta l4proto tcp accept'))

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


class PolicyPersistenceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'policy.json'
        for name, value in [
            ('POLICY_STATE', self.path),
            ('management_url', lambda _: None),
            ('network_families', lambda: ['-4', '-6']),
            ('network_lock', nullcontext),
            ('model_endpoints', set),
            ('host_bridge_endpoint', lambda: None),
            ('run', lambda *args, **kwargs: ''),
        ]:
            override = patch.object(network, name, value)
            override.start()
            self.addCleanup(override.stop)
        override = patch.object(network.subprocess, 'run', return_value=SimpleNamespace(returncode=2))
        override.start()
        self.addCleanup(override.stop)

    def test_allowlist_survives_host_bridge_refresh_and_repairs_state_permissions(self):
        self.path.write_text('{}')
        self.path.chmod(0o644)
        raw = {'mode': 'allowlist', 'rules': [
            {'address': '10.255.0.1', 'port': 80},
            {'address': 'fd75::2', 'port': 443},
        ]}
        network.update_network_policy('http://server:8788', raw)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(network.current_policy(), network.policy_value(raw))
        network.update_host_bridge('http://server:8788')
        self.assertEqual(network.current_policy(), network.policy_value(raw))

    def test_subnet_and_port_range_emit_pairwise_nft_and_route_rules(self):
        commands = []

        def record(*args, **kwargs):
            commands.append((args, kwargs))
            return ''

        with patch.object(network, 'run', record):
            network.update_network_policy('http://server:8788', {
                'mode': 'allowlist',
                'rules': [{'address': '10.20.30.9/24', 'port': '8000-8100'}],
            })
        nft = next(kwargs['input'] for args, kwargs in commands if args == ('nft', '-f', '-'))
        self.assertIn('ip daddr 10.20.30.0/24 tcp dport 8000-8100 meta mark set', nft)
        route = next(args for args, _ in commands if args[:4] == ('ip', '-4', 'rule', 'add') and args[args.index('pref') + 1] == '98' and 'dport' in args)
        self.assertEqual(route[route.index('to') + 1], '10.20.30.0/24')
        self.assertEqual(route[route.index('dport') + 1], '8000-8100')
        self.assertEqual(network.current_policy()['rules'], [('-4', '10.20.30.0/24', 8000, 8100)])

    def test_full_tcp_range_omits_linux_dport_selector(self):
        commands = []

        def record(*args, **kwargs):
            commands.append((args, kwargs))
            return ''

        with patch.object(network, 'run', record):
            network.update_network_policy('http://server:8788', {
                'mode': 'allowlist',
                'rules': [{'address': '10.20.30.0/24', 'port': '1-65535'}],
            })
        nft = next(kwargs['input'] for args, kwargs in commands if args == ('nft', '-f', '-'))
        self.assertIn('ip daddr 10.20.30.0/24 meta l4proto tcp meta mark set', nft)
        self.assertNotIn('ip daddr 10.20.30.0/24 tcp dport 1-65535', nft)
        route = next(args for args, _ in commands if args[:4] == ('ip', '-4', 'rule', 'add') and args[args.index('pref') + 1] == '98' and 'to' in args and 'dport' not in args)
        self.assertEqual(route[route.index('to') + 1], '10.20.30.0/24')

    def test_host_bridge_reads_policy_after_acquiring_network_lock(self):
        lan = {'mode': 'lan', 'rules': []}
        allowlist = {'mode': 'allowlist', 'rules': [{'address': '10.255.0.1', 'port': 80}]}
        network.update_network_policy('http://server:8788', lan)

        @contextmanager
        def concurrent_policy_update():
            self.path.write_text(json.dumps(allowlist))
            yield

        with patch.object(network, 'network_lock', concurrent_policy_update):
            network.update_host_bridge('http://server:8788')
        self.assertEqual(network.current_policy(), network.policy_value(allowlist))


if __name__ == '__main__':
    unittest.main()
