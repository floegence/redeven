FROM alpine:3.23
RUN apk add --no-cache openssh docker-cli && ssh-keygen -A && mkdir -p /run/sshd && adduser -D visitor && passwd -d root && passwd -d visitor
COPY authorized_keys /root/.ssh/authorized_keys
RUN chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys && mkdir -p /home/visitor/.ssh && cp /root/.ssh/authorized_keys /home/visitor/.ssh/authorized_keys && chown -R visitor:visitor /home/visitor/.ssh && chmod 700 /home/visitor/.ssh
CMD ["/usr/sbin/sshd", "-D", "-e", "-o", "PermitRootLogin=prohibit-password", "-o", "PasswordAuthentication=no", "-o", "AllowUsers=root visitor"]
