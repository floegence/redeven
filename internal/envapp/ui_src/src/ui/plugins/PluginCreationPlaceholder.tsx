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
        <div class="plugin-creation-sculpture" aria-hidden="true">
          <div class="plugin-sculpture-halo" />
          <div class="plugin-sculpture-shadow" />
          <div class="plugin-sculpture-materials">
            <span class="plugin-sculpture-petal plugin-sculpture-petal-a"><i /></span>
            <span class="plugin-sculpture-petal plugin-sculpture-petal-b"><i /></span>
            <span class="plugin-sculpture-petal plugin-sculpture-petal-c"><i /></span>
            <span class="plugin-sculpture-petal plugin-sculpture-petal-d"><i /></span>
          </div>
          <span class="plugin-sculpture-satellite plugin-sculpture-satellite-a" />
          <span class="plugin-sculpture-satellite plugin-sculpture-satellite-b" />
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
