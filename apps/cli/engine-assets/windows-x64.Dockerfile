FROM docker.io/library/debian@sha256:ab3b3c8c5159eebfca4376430132d53c4d425f869c765ecbe47177a030da575d

RUN --mount=type=secret,id=build_ca,required=true,mode=0444 \
    set -eu; \
    test "$(dpkg --print-architecture)" = amd64; \
    sed -i \
        -e 's|http://deb.debian.org/|https://snapshot.debian.org/archive/|' \
        -e '/^URIs:/s|$|/20261124T000000Z/|' \
        /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' 'Acquire::https::CaInfo "/run/secrets/build_ca";' \
        'Acquire::Check-Valid-Until "false";' 'Acquire::Retries "3";' \
        'Acquire::Languages "none";' > /etc/apt/apt.conf.d/99outcomego-build; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates=20250419+deb13u1 \
        docker-cli=26.1.5+dfsg1-9+deb13u1+b1 \
        docker-compose=2.26.1-4 \
        docker.io=26.1.5+dfsg1-9+deb13u1+b1 \
        systemd-sysv=257.13-1~deb13u1; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/log/apt/*; \
    rm -f /etc/apt/apt.conf.d/99outcomego-build /var/log/alternatives.log /var/log/dpkg.log \
        /var/lib/dpkg/status-old /var/cache/ldconfig/aux-cache /var/lib/systemd/random-seed; \
    : > /etc/machine-id
