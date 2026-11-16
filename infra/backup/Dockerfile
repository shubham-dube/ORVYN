# Nightly encrypted Postgres backup to R2 + weekly automatic restore test. See docs/guides/deploy.md.
FROM postgres:16-alpine
RUN apk add --no-cache age rclone curl tzdata \
 && wget -qO /usr/local/bin/supercronic https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-$(case "$(uname -m)" in aarch64) echo arm64;; *) echo amd64;; esac) \
 && chmod +x /usr/local/bin/supercronic
COPY backup.sh restore-test.sh /usr/local/bin/
COPY crontab /etc/crontab
ENV TZ=Asia/Kolkata
CMD ["supercronic", "/etc/crontab"]
