package hostnetwork

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Foundation -framework CFNetwork
#include <stdlib.h>
#include "proxy_darwin.h"
*/
import "C"

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strconv"
	"time"
	"unsafe"
)

func systemProxies(ctx context.Context, target *url.URL, fixture string) ([]*url.URL, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	raw := C.CString(target.String())
	defer C.free(unsafe.Pointer(raw))
	var config *C.char
	if fixture != "" {
		config = C.CString(fixture)
		defer C.free(unsafe.Pointer(config))
	}
	cancel := C.network_cancel_new()
	if cancel == nil {
		return nil, errors.New("allocate system proxy request")
	}
	defer C.network_cancel_free(cancel)
	stopped := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { C.network_cancel_set(cancel); close(stopped) })
	defer func() {
		if !stop() {
			<-stopped
		}
	}()
	budget := 30 * time.Second
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < budget {
		budget = time.Until(deadline)
	}
	value := C.network_proxies(raw, config, C.double(budget.Seconds()), cancel)
	if value != nil {
		defer C.free(unsafe.Pointer(value))
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if value == nil {
		return nil, errors.New("system proxy resolution failed")
	}
	var routes []struct {
		Scheme, Host, Username, Password string
		Port                             int
	}
	if err := json.Unmarshal([]byte(C.GoString(value)), &routes); err != nil {
		return nil, errors.New("invalid system proxy response")
	}
	result := make([]*url.URL, 0, len(routes))
	for _, route := range routes {
		if route.Scheme == "" {
			result = append(result, nil)
			continue
		}
		proxy := &url.URL{Scheme: route.Scheme, Host: net.JoinHostPort(route.Host, strconv.Itoa(route.Port))}
		if route.Username != "" {
			proxy.User = url.UserPassword(route.Username, route.Password)
		}
		result = append(result, proxy)
	}
	return result, nil
}
