#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#import <objc/message.h>
#include <node_api.h>
#include <cstring>
#include <dlfcn.h>

// Electron's native handle is its content NSView. Resolve only views belonging
// to this application's live windows, rather than dereferencing caller memory.
static NSWindow* GetWindow(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  void* bytes = nullptr;
  size_t size = 0;
  if (![NSThread isMainThread] ||
      napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_buffer_info(env, args[0], &bytes, &size) != napi_ok || size != sizeof(void*)) {
    napi_throw_type_error(env, nullptr, "A native window handle on the main thread is required");
    return nil;
  }
  void* pointer = nullptr;
  std::memcpy(&pointer, bytes, sizeof(pointer));
  for (NSWindow* window in NSApp.windows) {
    // AppKit can briefly retain a closed window whose contentView is nil.
    // A null handle must never resolve to that window.
    if (pointer && (__bridge void*)window.contentView == pointer) return window;
  }
  napi_throw_error(env, nullptr, "The native window is no longer available");
  return nil;
}

static napi_value Configure(napi_env env, napi_callback_info info) {
  NSWindow* window = GetWindow(env, info);
  if (!window) return nullptr;
  if (!(window.styleMask & NSWindowStyleMaskNonactivatingPanel)) {
    napi_throw_type_error(env, nullptr, "A nonactivating panel is required for a desktop window");
    return nullptr;
  }
  // ElectronNSPanel inherits NSWindow and only overrides the styleMask getter;
  // it never runs NSPanel's initialization of the WindowServer activation tag.
  // show()/focus() can therefore pass while a physical click ends Show Desktop.
  // Synchronize that tag on this window only, after setting its other behavior.
  // AppKit SPI; feature-detect it and never replace the native window's class.
  // See Electron v41 shell/browser/ui/cocoa/electron_ns_panel.mm and Wine's
  // dlls/winemac.drv/cocoa_window.m (_setPreventsActivation:).
  SEL preventsActivation = NSSelectorFromString(@"_setPreventsActivation:");
  if (![window respondsToSelector:preventsActivation]) {
    napi_throw_error(env, nullptr, "This macOS runtime cannot configure nonactivating desktop windows");
    return nullptr;
  }
  // SetAlwaysOnTop calls Chromium's SetZOrderLevel, which adds Managed even to
  // desktop windows. Managed, Transient and Stationary are mutually exclusive.
  // Apply this after Electron has set the level, without changing other flags.
  auto behavior = window.collectionBehavior;
  behavior &= ~(NSWindowCollectionBehaviorManaged | NSWindowCollectionBehaviorTransient |
                NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorParticipatesInCycle);
  behavior |= NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorCanJoinAllSpaces |
              NSWindowCollectionBehaviorIgnoresCycle;
  window.collectionBehavior = behavior;
  reinterpret_cast<void (*)(id, SEL, BOOL)>(objc_msgSend)(window, preventsActivation, YES);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Inspect(napi_env env, napi_callback_info info) {
  NSWindow* window = GetWindow(env, info);
  if (!window) return nullptr;
  napi_value result;
  napi_create_object(env, &result);
  const auto number = [&](const char* key, double value) {
    napi_value property;
    napi_create_double(env, value, &property);
    napi_set_named_property(env, result, key, property);
  };
  const auto boolean = [&](const char* key, bool value) {
    napi_value property;
    napi_get_boolean(env, value, &property);
    napi_set_named_property(env, result, key, property);
  };
  number("level", window.level);
  number("collectionBehavior", window.collectionBehavior);
  number("windowNumber", window.windowNumber);
  number("occlusionState", window.occlusionState);
  number("width", window.frame.size.width);
  number("height", window.frame.size.height);
  boolean("ignoresMouseEvents", window.ignoresMouseEvents);
  boolean("nonactivatingPanel", (window.styleMask & NSWindowStyleMaskNonactivatingPanel) != 0);
  SEL nativePanel = NSSelectorFromString(@"_isNonactivatingPanel");
  boolean("nativeNonactivatingPanel", [window respondsToSelector:nativePanel] &&
          reinterpret_cast<BOOL (*)(id, SEL)>(objc_msgSend)(window, nativePanel));
  // Read-only diagnostics for regression tests. A style-mask assertion alone
  // misses the click-activation bug. Missing SPI is reported as null, not false.
  const auto connection = reinterpret_cast<int32_t (*)()>(dlsym(RTLD_DEFAULT, "CGSMainConnectionID"));
  const auto getTags = reinterpret_cast<int32_t (*)(int32_t, int32_t, uint32_t*, int32_t)>(dlsym(RTLD_DEFAULT, "CGSGetWindowTags"));
  uint32_t tags[2] = {0, 0};
  if (connection && getTags && getTags(connection(), static_cast<int32_t>(window.windowNumber), tags, 64) == 0) {
    boolean("preventsActivationTag", (tags[0] & (1 << 16)) != 0);
  } else {
    napi_value unavailable;
    napi_get_null(env, &unavailable);
    napi_set_named_property(env, result, "preventsActivationTag", unavailable);
  }
  // NSApp.active also becomes true for a nonactivating panel with key focus.
  // NSRunningApplication/NSWorkspace report actual foreground activation.
  boolean("applicationActive", NSRunningApplication.currentApplication.active);
  number("frontmostProcess", NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);
  boolean("applicationHidden", NSApp.hidden);
  boolean("keyWindow", window.keyWindow);
  boolean("canBecomeMainWindow", window.canBecomeMainWindow);
  return result;
}

static napi_value IsPrimaryMouseButtonDown(napi_env env, napi_callback_info) {
  // Read current button state only while our own drag is active. This needs no
  // event tap, global input interception or Accessibility permission.
  napi_value result;
  napi_get_boolean(env, (NSEvent.pressedMouseButtons & 1) != 0, &result);
  return result;
}

struct NotificationSettingsRequest {
  napi_async_work work = nullptr;
  napi_deferred deferred;
  int authorizationStatus = -1, alertSetting = -1, alertStyle = -1;
  int notificationCenterSetting = -1, soundSetting = -1;
};

static void ReadNotificationSettings(napi_env, void* data) {
  auto* request = static_cast<NotificationSettingsRequest*>(data);
  @autoreleasepool {
    // Run the wait on Node's worker pool, never on Electron's UI thread.
    // The block owns its result storage even if the query times out.
    __block UNNotificationSettings* settings = nil;
    dispatch_semaphore_t ready = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings* result) {
      settings = result;
      dispatch_semaphore_signal(ready);
    }];
    if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC)) == 0 && settings) {
      request->authorizationStatus = static_cast<int>(settings.authorizationStatus);
      request->alertSetting = static_cast<int>(settings.alertSetting);
      request->alertStyle = static_cast<int>(settings.alertStyle);
      request->notificationCenterSetting = static_cast<int>(settings.notificationCenterSetting);
      request->soundSetting = static_cast<int>(settings.soundSetting);
    }
  }
}

static void CompleteNotificationSettings(napi_env env, napi_status status, void* data) {
  auto* request = static_cast<NotificationSettingsRequest*>(data);
  napi_value result;
  napi_create_object(env, &result);
  if (status == napi_ok) {
    const auto number = [&](const char* key, int value) {
      napi_value property;
      napi_create_int32(env, value, &property);
      napi_set_named_property(env, result, key, property);
    };
    number("authorizationStatus", request->authorizationStatus);
    number("alertSetting", request->alertSetting);
    number("alertStyle", request->alertStyle);
    number("notificationCenterSetting", request->notificationCenterSetting);
    number("soundSetting", request->soundSetting);
  }
  napi_resolve_deferred(env, request->deferred, result);
  napi_delete_async_work(env, request->work);
  delete request;
}

static napi_value GetNotificationSettings(napi_env env, napi_callback_info) {
  auto* request = new NotificationSettingsRequest();
  napi_value promise, name;
  napi_create_promise(env, &request->deferred, &promise);
  napi_create_string_utf8(env, "OKNoteNotificationSettings", NAPI_AUTO_LENGTH, &name);
  if (napi_create_async_work(env, nullptr, name, ReadNotificationSettings, CompleteNotificationSettings,
      request, &request->work) != napi_ok || napi_queue_async_work(env, request->work) != napi_ok) {
    if (request->work) napi_delete_async_work(env, request->work);
    delete request;
    napi_throw_error(env, nullptr, "Could not read macOS notification settings");
    return nullptr;
  }
  return promise;
}

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"configure", nullptr, Configure, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspect", nullptr, Inspect, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isPrimaryMouseButtonDown", nullptr, IsPrimaryMouseButtonDown, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getNotificationSettings", nullptr, GetNotificationSettings, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, properties);
  return exports;
}
