#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Sparkle/Sparkle.h>

#include <node_api.h>
#include <string>

@interface RedevenSparkleDelegate : NSObject <SPUUpdaterDelegate, SPUStandardUserDriverDelegate>
@property(nonatomic, copy, nullable) void (^pendingInstallHandler)(void);
@end

namespace {

struct BridgeState {
  napi_env env = nullptr;
  napi_ref callback = nullptr;
  __strong SPUStandardUpdaterController *controller = nil;
  __strong RedevenSparkleDelegate *delegate = nil;
  std::string state = "idle";
  std::string availableVersion;
  std::string errorDetail;
  bool started = false;
};

BridgeState g_bridge;

std::string UTF8(NSString *value) {
  if (value == nil) return {};
  const char *text = value.UTF8String;
  return text == nullptr ? std::string() : std::string(text);
}

napi_value String(napi_env env, const std::string &value) {
  napi_value result;
  napi_create_string_utf8(env, value.c_str(), value.size(), &result);
  return result;
}

void SetString(napi_env env, napi_value object, const char *name, const std::string &value) {
  napi_set_named_property(env, object, name, String(env, value));
}

void SetBool(napi_env env, napi_value object, const char *name, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  napi_set_named_property(env, object, name, result);
}

napi_value SnapshotObject(napi_env env) {
  napi_value snapshot;
  napi_create_object(env, &snapshot);
  SetString(env, snapshot, "kind", "snapshot");
  SetString(env, snapshot, "state", g_bridge.state);
  SetString(env, snapshot, "available_version", g_bridge.availableVersion);
  SetString(env, snapshot, "error_detail", g_bridge.errorDetail);
  SPUUpdater *updater = g_bridge.controller.updater;
  SetBool(env, snapshot, "can_check", updater != nil && updater.canCheckForUpdates);
  SetBool(env, snapshot, "automatically_checks_for_updates",
          updater != nil && updater.automaticallyChecksForUpdates);
  return snapshot;
}

void EmitSnapshot() {
  if (g_bridge.env == nullptr || g_bridge.callback == nullptr) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(g_bridge.env, &scope) != napi_ok) return;
  napi_value callback;
  napi_value global;
  napi_get_reference_value(g_bridge.env, g_bridge.callback, &callback);
  napi_get_global(g_bridge.env, &global);
  napi_value event = SnapshotObject(g_bridge.env);
  napi_value result;
  napi_call_function(g_bridge.env, global, callback, 1, &event, &result);
  napi_close_handle_scope(g_bridge.env, scope);
}

void SetState(const char *state, NSString *version = nil, NSError *error = nil) {
  g_bridge.state = state;
  if (version != nil) g_bridge.availableVersion = UTF8(version);
  g_bridge.errorDetail = error == nil ? std::string() : UTF8(error.localizedDescription);
  EmitSnapshot();
}

void EmitInstallRequest() {
  if (g_bridge.env == nullptr || g_bridge.callback == nullptr) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(g_bridge.env, &scope) != napi_ok) return;
  napi_value callback;
  napi_value global;
  napi_get_reference_value(g_bridge.env, g_bridge.callback, &callback);
  napi_get_global(g_bridge.env, &global);
  napi_value event;
  napi_create_object(g_bridge.env, &event);
  SetString(g_bridge.env, event, "kind", "install_requested");
  napi_value result;
  napi_call_function(g_bridge.env, global, callback, 1, &event, &result);
  napi_close_handle_scope(g_bridge.env, scope);
}

bool RequireMainThread(napi_env env) {
  if (![NSThread isMainThread]) {
    napi_throw_error(env, "ERR_SPARKLE_MAIN_THREAD", "Sparkle must be called from Electron's main thread.");
    return false;
  }
  return true;
}

napi_value Start(napi_env env, napi_callback_info info) {
  if (!RequireMainThread(env)) return nullptr;
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_valuetype callbackType = napi_undefined;
  if (argc != 1 || napi_typeof(env, argv[0], &callbackType) != napi_ok || callbackType != napi_function) {
    napi_throw_type_error(env, nullptr, "Sparkle start requires one event callback.");
    return nullptr;
  }
  if (g_bridge.callback != nullptr) {
    napi_delete_reference(env, g_bridge.callback);
    g_bridge.callback = nullptr;
  }
  g_bridge.env = env;
  napi_create_reference(env, argv[0], 1, &g_bridge.callback);
  if (!g_bridge.started) {
    g_bridge.delegate = [RedevenSparkleDelegate new];
    g_bridge.controller = [[SPUStandardUpdaterController alloc]
        initWithStartingUpdater:NO
        updaterDelegate:g_bridge.delegate
        userDriverDelegate:g_bridge.delegate];
    [g_bridge.controller startUpdater];
    g_bridge.started = true;
  }
  EmitSnapshot();
  return SnapshotObject(env);
}

napi_value Snapshot(napi_env env, napi_callback_info info) {
  (void)info;
  if (!RequireMainThread(env)) return nullptr;
  return SnapshotObject(env);
}

napi_value CheckForUpdates(napi_env env, napi_callback_info info) {
  (void)info;
  if (!RequireMainThread(env)) return nullptr;
  if (!g_bridge.started || g_bridge.controller == nil) {
    napi_throw_error(env, "ERR_SPARKLE_NOT_STARTED", "Sparkle has not been started.");
    return nullptr;
  }
  [g_bridge.controller checkForUpdates:nil];
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value SetAutomaticallyChecks(napi_env env, napi_callback_info info) {
  if (!RequireMainThread(env)) return nullptr;
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  bool enabled = false;
  if (argc != 1 || napi_get_value_bool(env, argv[0], &enabled) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Automatic update checks require a boolean value.");
    return nullptr;
  }
  if (!g_bridge.started || g_bridge.controller == nil) {
    napi_throw_error(env, "ERR_SPARKLE_NOT_STARTED", "Sparkle has not been started.");
    return nullptr;
  }
  g_bridge.controller.updater.automaticallyChecksForUpdates = enabled;
  EmitSnapshot();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value ContinueInstallation(napi_env env, napi_callback_info info) {
  (void)info;
  if (!RequireMainThread(env)) return nullptr;
  void (^handler)(void) = g_bridge.delegate.pendingInstallHandler;
  g_bridge.delegate.pendingInstallHandler = nil;
  if (handler != nil) handler();
  napi_value result;
  napi_get_boolean(env, handler != nil, &result);
  return result;
}

void Cleanup(void *) {
  if (g_bridge.callback != nullptr && g_bridge.env != nullptr) {
    napi_delete_reference(g_bridge.env, g_bridge.callback);
  }
  g_bridge.callback = nullptr;
  g_bridge.env = nullptr;
  g_bridge.delegate.pendingInstallHandler = nil;
  g_bridge.controller = nil;
  g_bridge.delegate = nil;
  g_bridge.started = false;
}

}  // namespace

@implementation RedevenSparkleDelegate

- (BOOL)updater:(SPUUpdater *)updater
    mayPerformUpdateCheck:(SPUUpdateCheck)updateCheck
                    error:(NSError *__autoreleasing *)error {
  (void)updater;
  (void)updateCheck;
  (void)error;
  SetState("checking");
  return YES;
}

- (NSSet<NSString *> *)allowedChannelsForUpdater:(SPUUpdater *)updater {
  (void)updater;
  return [NSSet set];
}

- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
  (void)updater;
  SetState("available", item.displayVersionString);
}

- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater {
  (void)updater;
  SetState("idle");
}

- (void)updater:(SPUUpdater *)updater
    willDownloadUpdate:(SUAppcastItem *)item
           withRequest:(NSMutableURLRequest *)request {
  (void)updater;
  (void)request;
  SetState("downloading", item.displayVersionString);
}

- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item {
  (void)updater;
  SetState("ready", item.displayVersionString);
}

- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item {
  (void)updater;
  SetState("installing", item.displayVersionString);
}

- (BOOL)updater:(SPUUpdater *)updater
    shouldPostponeRelaunchForUpdate:(SUAppcastItem *)item
               untilInvokingBlock:(void (^)(void))installHandler {
  (void)updater;
  SetState("installing", item.displayVersionString);
  if (self.pendingInstallHandler == nil) {
    self.pendingInstallHandler = installHandler;
    EmitInstallRequest();
  }
  return YES;
}

- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error {
  (void)updater;
  self.pendingInstallHandler = nil;
  SetState("error", nil, error);
}

- (void)updater:(SPUUpdater *)updater
    didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)updateCheck
                                 error:(NSError *)error {
  (void)updater;
  (void)updateCheck;
  if (error != nil) {
    SetState("error", nil, error);
    return;
  }
  if (self.pendingInstallHandler == nil &&
             g_bridge.state != "available" &&
             g_bridge.state != "ready" &&
             g_bridge.state != "installing") {
    SetState("idle");
  } else {
    EmitSnapshot();
  }
}

- (void)standardUserDriverWillHandleShowingUpdate:(BOOL)handleShowingUpdate
                                         forUpdate:(SUAppcastItem *)update
                                             state:(SPUUserUpdateState *)state {
  (void)handleShowingUpdate;
  (void)state;
  SetState("available", update.displayVersionString);
}

- (void)standardUserDriverWillFinishUpdateSession {
  if (self.pendingInstallHandler == nil && g_bridge.state != "installing") {
    SetState("idle");
  }
}

@end

NAPI_MODULE_INIT() {
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  napi_property_descriptor properties[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"snapshot", nullptr, Snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"checkForUpdates", nullptr, CheckForUpdates, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"openUpdateUI", nullptr, CheckForUpdates, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setAutomaticallyChecksForUpdates", nullptr, SetAutomaticallyChecks, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"continueInstallation", nullptr, ContinueInstallation, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
