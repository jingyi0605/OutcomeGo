#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Loaded ONLY in the supervisor's relay worker. Mark before connect/DNS so
 * those transport sockets use the underlay, regardless of UID. Applications,
 * including sudo descendants and diagnostics, never inherit this library.
 * This is routing policy, not an isolation boundary against administrators. */
static unsigned int control_address;
static unsigned short control_port;
static int control_loaded;

static void load_control_endpoint(void) {
  if (control_loaded) return;
  control_loaded = 1;
  const char *address = getenv("OUTCOMEGO_NETWORK_CONTROL_IPV4");
  const char *port = getenv("OUTCOMEGO_NETWORK_CONTROL_PORT");
  if (!address || !port) return;
  struct in_addr parsed;
  char *end = NULL;
  unsigned long parsed_port = strtoul(port, &end, 10);
  if (inet_pton(AF_INET, address, &parsed) != 1 || !end || *end || parsed_port > 65535)
    return;
  control_address = parsed.s_addr;
  control_port = (unsigned short)parsed_port;
}

int socket(int domain, int type, int protocol) {
  int fd = (int)syscall(SYS_socket, domain, type, protocol);
  if (fd >= 0 && (domain == AF_INET || domain == AF_INET6)) {
    unsigned int mark = 0x4f54;
    if (setsockopt(fd, SOL_SOCKET, SO_MARK, &mark, sizeof(mark)) < 0) {
      int error = errno;
      close(fd);
      errno = error;
      return -1;
    }
  }
  return fd;
}

int connect(int fd, const struct sockaddr *address, socklen_t length) {
  load_control_endpoint();
  if (control_address && address && address->sa_family == AF_INET &&
      length >= sizeof(struct sockaddr_in)) {
    const struct sockaddr_in *endpoint = (const struct sockaddr_in *)address;
    if (endpoint->sin_addr.s_addr == control_address &&
        ntohs(endpoint->sin_port) == control_port) {
      unsigned int mark = 0;
      (void)setsockopt(fd, SOL_SOCKET, SO_MARK, &mark, sizeof(mark));
    }
  }
  return (int)syscall(SYS_connect, fd, address, length);
}
