import { Show } from 'solid-js';
import { useI18n } from '../i18n';
import { PluginCreationCanvasBackground } from './PluginCreationCanvasBackground';
import './plugin-creation-placeholder.css';

/** Decorative composition, not a generated application or simulated build progress. */
export function PluginCreationPlaceholder(props: { active: boolean; state: 'running' | 'failed' | 'passed' | 'not_run'; onChecks: () => void }) {
  const i18n = useI18n();
  const label = () => props.state === 'running' ? 'uiCopy.plugin.creation.building'
    : props.state === 'failed' ? 'uiCopy.plugin.creation.failed' : 'uiCopy.plugin.creation.preview';
  return (
    <div class="plugin-creation-empty-preview" data-build-state={props.state}>
      <PluginCreationCanvasBackground active={props.active && props.state !== 'failed'} />
      <div class="plugin-creation-placeholder">
        <svg class="plugin-creation-blueprint" viewBox="0 0 360 244" fill="none" aria-hidden="true">
          <path class="plugin-blueprint-guides" d="M8 36V12h24M328 12h24v24M8 208v24h24M328 232h24v-24" />
          <g class="plugin-blueprint-sheet">
            <rect class="plugin-blueprint-paper" x="24" y="28" width="312" height="188" rx="10" />
            <path class="plugin-blueprint-rule" d="M24 60h312M78 60v156" />
            <rect class="plugin-blueprint-ink" x="38" y="41" width="9" height="9" rx="3" />
            <rect class="plugin-blueprint-muted" x="54" y="43" width="46" height="4" rx="2" />
            <circle class="plugin-blueprint-muted" cx="320" cy="45" r="4" />
            <g class="plugin-blueprint-navigation">
              <rect class="plugin-blueprint-tint" x="34" y="74" width="34" height="22" rx="5" />
              <path class="plugin-blueprint-accent" d="M44 82h5v6h-5zM53 82h5v6h-5z" />
              <path class="plugin-blueprint-muted" d="M44 108h14v4H44zM44 130h14v4H44zM44 152h10v4H44z" />
              <circle class="plugin-blueprint-muted" cx="51" cy="197" r="5" />
            </g>
            <g class="plugin-blueprint-heading">
              <rect class="plugin-blueprint-ink" x="94" y="78" width="86" height="6" rx="3" />
              <rect class="plugin-blueprint-muted" x="94" y="91" width="122" height="4" rx="2" />
              <rect class="plugin-blueprint-tint" x="290" y="76" width="30" height="17" rx="5" />
            </g>
            <g class="plugin-blueprint-summary">
              <rect class="plugin-blueprint-tile" x="94" y="111" width="106" height="38" rx="6" />
              <rect class="plugin-blueprint-muted" x="105" y="122" width="34" height="3" rx="1.5" />
              <rect class="plugin-blueprint-ink" x="105" y="132" width="47" height="5" rx="2.5" />
              <path class="plugin-blueprint-spark" d="m165 136 6-5 6 2 7-8 5 2" />
            </g>
            <g class="plugin-blueprint-secondary">
              <rect class="plugin-blueprint-tile" x="212" y="111" width="108" height="38" rx="6" />
              <rect class="plugin-blueprint-muted" x="223" y="122" width="40" height="3" rx="1.5" />
              <rect class="plugin-blueprint-ink" x="223" y="132" width="32" height="5" rx="2.5" />
              <circle class="plugin-blueprint-tint" cx="302" cy="130" r="8" />
            </g>
            <g class="plugin-blueprint-detail">
              <rect class="plugin-blueprint-tile" x="94" y="161" width="226" height="39" rx="6" />
              <path class="plugin-blueprint-rule" d="M106 187h202" />
              <rect class="plugin-blueprint-muted" x="106" y="172" width="52" height="4" rx="2" />
              <path class="plugin-blueprint-spark" d="m180 181 18-3 14 2 18-9 16 3 18-7 18 4 26-5" />
            </g>
          </g>
        </svg>
        <div class="plugin-creation-placeholder-caption" role="status" aria-live="polite">
          <span class="plugin-creation-placeholder-state"><i aria-hidden="true" />{i18n.t(label())}</span>
          <p>{i18n.t('uiCopy.plugin.creation.emptyPreview')}</p>
        </div>
        <Show when={props.state === 'failed'}>
          <button type="button" class="plugin-creation-placeholder-checks" onClick={props.onChecks}>{i18n.t('uiCopy.plugin.creation.checks')}<span aria-hidden="true">↗</span></button>
        </Show>
      </div>
    </div>
  );
}
