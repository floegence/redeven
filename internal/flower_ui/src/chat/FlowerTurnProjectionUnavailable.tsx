import { AlertCircle } from '@floegence/floe-webapp-core/icons';

import type { FlowerTimelineDecoration } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';

export function FlowerTurnProjectionUnavailable(props: {
  decoration: Extract<FlowerTimelineDecoration, { kind: 'turn_projection_unavailable' }>;
  copy: FlowerSurfaceCopy;
}) {
  const payload = () => props.decoration.projection_unavailable;
  return (
    <div
      class="flower-projection-unavailable"
      role="status"
      data-flower-turn-projection-unavailable
      data-flower-decoration-id={props.decoration.decoration_id}
      data-flower-turn-id={payload().turn_id}
      data-flower-run-id={payload().run_id}
      data-flower-expected-message-id={payload().expected_message_id}
      data-flower-projection-unavailable-reason={payload().reason}
    >
      <AlertCircle class="flower-projection-unavailable-icon" aria-hidden="true" />
      <span class="flower-projection-unavailable-copy">
        <strong>{props.copy.chat.projectionUnavailable.title}</strong>
        <span>{props.copy.chat.projectionUnavailable.description}</span>
      </span>
    </div>
  );
}
