import { FlowerThinkingOrb } from './FlowerThinkingOrb';

type WebFetchSearchingOrbProps = Readonly<{
  running: boolean;
}>;

export function WebFetchSearchingOrb(props: WebFetchSearchingOrbProps) {
  return (
    <FlowerThinkingOrb
      class="flower-activity-web-fetch-searching-orb"
      running={props.running}
      state="searching"
    />
  );
}
