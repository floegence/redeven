#import <Foundation/Foundation.h>
#import <CFNetwork/CFNetwork.h>
#include <stdatomic.h>
#include "proxy_darwin.h"

struct network_cancel { atomic_bool cancelled; };
network_cancel *network_cancel_new(void) {
    network_cancel *value = calloc(1, sizeof(*value));
    if (value) atomic_init(&value->cancelled, false);
    return value;
}
void network_cancel_set(network_cancel *value) { atomic_store(&value->cancelled, true); }
void network_cancel_free(network_cancel *value) { free(value); }

typedef struct { CFArrayRef proxies; CFErrorRef error; bool done; } pac_result;
static void pac_done(void *context, CFArrayRef proxies, CFErrorRef error) {
    pac_result *result = context;
    if (proxies) result->proxies = CFRetain(proxies);
    if (error) result->error = (CFErrorRef)CFRetain(error);
    result->done = true;
}
static CFArrayRef resolve_pac(CFDictionaryRef proxy, CFURLRef target, double seconds, network_cancel *cancel) {
    pac_result result = {0};
    CFStreamClientContext context = {0, &result, NULL, NULL, NULL};
    CFRunLoopSourceRef source = NULL;
    CFTypeRef type = CFDictionaryGetValue(proxy, kCFProxyTypeKey);
    if (CFEqual(type, kCFProxyTypeAutoConfigurationURL)) {
        CFURLRef url = CFDictionaryGetValue(proxy, kCFProxyAutoConfigurationURLKey);
        if (url) source = CFNetworkExecuteProxyAutoConfigurationURL(url, target, pac_done, &context);
    } else {
        CFStringRef script = CFDictionaryGetValue(proxy, kCFProxyAutoConfigurationJavaScriptKey);
        if (script) source = CFNetworkExecuteProxyAutoConfigurationScript(script, target, pac_done, &context);
    }
    if (!source) return NULL;
    CFStringRef mode = CFSTR("RedevenNetworkProxy");
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, mode);
    double end = NSProcessInfo.processInfo.systemUptime + seconds;
    while (!result.done && !atomic_load(&cancel->cancelled) && NSProcessInfo.processInfo.systemUptime < end)
        CFRunLoopRunInMode(mode, 0.05, false);
    CFRunLoopSourceInvalidate(source);
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, mode);
    CFRelease(source);
    if (result.error) CFRelease(result.error);
    if (!result.done || result.error || atomic_load(&cancel->cancelled)) {
        if (result.proxies) CFRelease(result.proxies);
        return NULL;
    }
    return result.proxies;
}

char *network_proxies(const char *raw, const char *fixture, double seconds, network_cancel *cancel) {
    @autoreleasepool {
        NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:raw]];
        if (!url) return NULL;
        NSDictionary *settings;
        if (fixture) {
            NSData *data = [[NSString stringWithUTF8String:fixture] dataUsingEncoding:NSUTF8StringEncoding];
            settings = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
            if (![settings isKindOfClass:NSDictionary.class]) return NULL;
        } else {
            settings = CFBridgingRelease(CFNetworkCopySystemProxySettings());
        }
        // CFNetwork also returns NULL when no proxy settings are defined.
        if (!settings) settings = @{};
        NSArray *proxies = CFBridgingRelease(CFNetworkCopyProxiesForURL((__bridge CFURLRef)url, (__bridge CFDictionaryRef)settings));
        if (!proxies) return NULL;
        NSMutableArray *expanded = [NSMutableArray array];
        for (NSDictionary *proxy in proxies) {
            id type = proxy[(__bridge NSString *)kCFProxyTypeKey];
            if ([type isEqual:(__bridge NSString *)kCFProxyTypeAutoConfigurationURL] ||
                [type isEqual:(__bridge NSString *)kCFProxyTypeAutoConfigurationJavaScript]) {
                NSArray *resolved = CFBridgingRelease(resolve_pac((__bridge CFDictionaryRef)proxy, (__bridge CFURLRef)url, seconds, cancel));
                if (!resolved) return NULL;
                [expanded addObjectsFromArray:resolved];
            } else [expanded addObject:proxy];
        }
        NSMutableArray *routes = [NSMutableArray array];
        for (NSDictionary *proxy in expanded) {
            NSString *type = proxy[(__bridge NSString *)kCFProxyTypeKey];
            if ([type isEqual:(__bridge NSString *)kCFProxyTypeNone]) { [routes addObject:@{}]; continue; }
            NSString *scheme;
            if ([type isEqual:(__bridge NSString *)kCFProxyTypeHTTP]) scheme = @"http";
            else if ([type isEqual:(__bridge NSString *)kCFProxyTypeHTTPS]) scheme = @"http";
            else if ([type isEqual:(__bridge NSString *)kCFProxyTypeSOCKS]) scheme = @"socks5";
            else return NULL;
            NSString *host = proxy[(__bridge NSString *)kCFProxyHostNameKey];
            NSNumber *port = proxy[(__bridge NSString *)kCFProxyPortNumberKey];
            if (!host.length || !port || port.intValue < 1 || port.intValue > 65535) return NULL;
            NSMutableDictionary *route = [@{@"scheme":scheme, @"host":host, @"port":port} mutableCopy];
            NSString *user = proxy[(__bridge NSString *)kCFProxyUsernameKey];
            NSString *password = proxy[(__bridge NSString *)kCFProxyPasswordKey];
            if (user) route[@"username"] = user;
            if (password) route[@"password"] = password;
            [routes addObject:route];
        }
        if (!routes.count || atomic_load(&cancel->cancelled)) return NULL;
        NSData *json = [NSJSONSerialization dataWithJSONObject:routes options:0 error:NULL];
        return json ? strndup(json.bytes, json.length) : NULL;
    }
}
