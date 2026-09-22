import { createSignal, onMount, onCleanup } from "solid-js";
import { EnvironmentAccessGate } from "./EnvironmentAccessGate";
import { useI18n } from "./i18n";
import {
  AccessUnlockError,
  formatAccessUnlockRetryAfter,
} from "./services/accessUnlockError";
import type {
  AccessAuthenticationRequest,
  EnvAppAccessUnlockResult,
} from "./services/localApi";

const storageKey = "redeven:resource-access:v1";

// The isolated application origin and Runtime channel bind this gate to its
// resource. It never promotes a Cloud cookie or an Env App token into access.
export function ResourceAccessGate(
  props: { local?: boolean; navigate?: () => void } = {},
) {
  const i18n = useI18n();
  const [value, setValue] = createSignal("");
  const [challenge, setChallenge] = createSignal("");
  const [recovery, setRecovery] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [checking, setChecking] = createSignal(true);
  const [error, setError] = createSignal("");
  const [retryUntil, setRetryUntil] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  let input: HTMLInputElement | undefined;
  let disposed = false;
  const navigate = () => {
    if (!disposed) (props.navigate ?? (() => location.reload()))();
  };
  const timer = setInterval(() => setNow(Date.now()), 500);
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
  });
  async function authenticate(
    request: AccessAuthenticationRequest & { resume_token?: string },
  ): Promise<EnvAppAccessUnlockResult> {
    const response = await fetch(
      props.local
        ? "/api/local/access/unlock"
        : "/_redeven_proxy/api/access/unlock",
      {
        method: "POST",
        credentials: props.local ? "same-origin" : "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    const body = await response.json();
    if (!response.ok || body.ok !== true)
      throw new AccessUnlockError({
        message: body.error?.message ?? "",
        code: body.error?.code,
        retryAfterMs: body.error?.retry_after_ms,
        status: response.status,
      });
    if (!body.data?.unlocked && !body.data?.second_factor_required)
      throw new Error("Invalid authentication response");
    return body.data;
  }
  onMount(async () => {
    try {
      const raw = props.local ? null : sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved.token === "string" && saved.expires_at > Date.now()) {
          const result = await authenticate({ resume_token: saved.token });
          if (result.unlocked) {
            navigate();
            return;
          }
        }
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Storage can be disabled. */
      }
    } finally {
      if (!disposed) {
        setChecking(false);
        queueMicrotask(() => input?.focus());
      }
    }
  });
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy() || !value() || retryUntil() > Date.now()) return;
    setBusy(true);
    setError("");
    try {
      const result = await authenticate(
        challenge()
          ? {
              challenge_id: challenge(),
              ...(recovery() ? { recovery_code: value() } : { code: value() }),
            }
          : { password: value() },
      );
      if (disposed) return;
      setValue("");
      if (result.second_factor_required && result.challenge_id) {
        setChallenge(result.challenge_id);
        queueMicrotask(() => input?.focus());
        return;
      }
      if (!props.local && result.resume_token) {
        try {
          sessionStorage.setItem(
            storageKey,
            JSON.stringify({
              token: result.resume_token,
              expires_at: result.resume_expires_at_unix_ms,
            }),
          );
        } catch {
          /* Current channel still works without storage. */
        }
      }
      navigate();
    } catch (failure) {
      if (disposed) return;
      const code = failure instanceof AccessUnlockError ? failure.code : "";
      if (code === "ACCESS_CHALLENGE_EXPIRED") {
        setChallenge("");
        setRecovery(false);
        setValue("");
      }
      setRetryUntil(
        Date.now() +
          (failure instanceof AccessUnlockError ? failure.retryAfterMs : 0),
      );
      const key =
        code === "ACCESS_FACTOR_INVALID"
          ? "accessGate.invalidFactorError"
          : code === "ACCESS_CHALLENGE_EXPIRED"
            ? "accessGate.challengeExpiredError"
            : code === "ACCESS_RECOVERY_PENDING"
              ? "accessGate.recoveryPendingError"
              : code === "ACCESS_PASSWORD_INVALID"
                ? "accessGate.errors.invalidPassword"
                : code === "ACCESS_PASSWORD_RETRY_LATER"
                  ? "accessGate.errors.retryLater"
                  : "accessGate.unavailableError";
      setError(i18n.t(key));
      queueMicrotask(() => {
        input?.focus();
        input?.select();
      });
    } finally {
      if (!disposed) setBusy(false);
    }
  };
  return (
    <EnvironmentAccessGate
      phase={checking() ? "checking" : "unlock_required"}
      secondFactor={!!challenge()}
      recoveryCode={recovery()}
      local={!!props.local}
      environmentName="Redeven"
      pending={checking()}
      unlocking={busy()}
      recoveryBusy={false}
      retryActive={retryUntil() > now()}
      retryDuration={formatAccessUnlockRetryAfter(
        Math.max(0, retryUntil() - now()),
      )}
      password={value()}
      error={error()}
      languageMenu={null}
      inputRef={(element) => {
        input = element;
      }}
      onPasswordInput={setValue}
      onSubmit={submit}
      onRetry={async () => navigate()}
      onReload={navigate}
      onToggleRecovery={() => {
        setRecovery(!recovery());
        setValue("");
        setError("");
      }}
      onBackToPassword={() => {
        setChallenge("");
        setRecovery(false);
        setValue("");
        setError("");
      }}
    />
  );
}
