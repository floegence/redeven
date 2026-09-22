import { render } from "solid-js/web";
import { FloeProvider } from "@floegence/floe-webapp-core";
import { I18nProvider } from "./ui/i18n";
import { ResourceAccessGate } from "./ui/ResourceAccessGate";
import "./index.css";

render(
  () => (
    <FloeProvider>
      <I18nProvider>
        <ResourceAccessGate
          local={document.documentElement.dataset.redevenLocalAccess === "true"}
        />
      </I18nProvider>
    </FloeProvider>
  ),
  document.getElementById("root")!,
);
