#include <stdbool.h>
typedef struct network_cancel network_cancel;
network_cancel *network_cancel_new(void);
void network_cancel_set(network_cancel *);
void network_cancel_free(network_cancel *);
char *network_proxies(const char *, const char *, double, network_cancel *);
