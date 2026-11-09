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
        <div class="plugin-creation-composition" aria-hidden="true">
          {/* A typographic specimen is artwork, not product copy. */}
          <span class="plugin-composition-type" data-specimen="Aa">Aa</span>
          <span class="plugin-composition-palette"><i /><i /><i /></span>
          <span class="plugin-composition-text"><i /><i /><i /></span>
          <span class="plugin-composition-chart"><i /><i /><i /><i /></span>
        </div>
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
