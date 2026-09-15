import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Pencil } from '@floegence/floe-webapp-core/icons';
import { Button, RadioGroup, RadioOption } from '@floegence/floe-webapp-core/ui';

import { FlowerKeyedList } from './FlowerKeyedList';
import type { FlowerInputRequestChoice, FlowerInputRequestQuestion } from './contracts/flowerSurfaceContracts';

export default function FlowerInputChoices(props: Readonly<{
  threadID: string;
  question: FlowerInputRequestQuestion;
  selectedChoiceID: string;
  customSelected: boolean;
  showCustomChoice: boolean;
  customLabel: string;
  disabled: boolean;
  onSelectChoice: (choice: FlowerInputRequestChoice) => void;
  onSelectCustom: () => void;
  focusFallback: () => void;
}>): JSX.Element {
  return (
    <RadioGroup
      class="flower-input-request-choice-grid"
      value={props.selectedChoiceID}
      onChange={(choiceID) => {
        const choice = props.question.choices?.find((candidate) => candidate.choice_id === choiceID);
        if (choice) props.onSelectChoice(choice);
      }}
      disabled={props.disabled}
      aria-label={props.question.question}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const radios = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[role="radio"]:not(:disabled)'));
        const currentIndex = radios.indexOf(document.activeElement as HTMLInputElement | HTMLButtonElement);
        if (radios.length === 0) return;
        event.preventDefault();
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        const next = radios[(currentIndex + offset + radios.length) % radios.length];
        next?.focus();
        next?.click();
      }}
    >
      <FlowerKeyedList scope={props.threadID} focusFallback={props.focusFallback} each={props.question.choices ?? []} identity={(choice) => choice.choice_id}>
        {(choice) => (
          <RadioOption
            value={choice().choice_id}
            role="radio"
            label={choice().label}
            description={choice().description}
            class={cn(
              'flower-input-request-choice',
              props.selectedChoiceID === choice().choice_id && 'flower-input-request-choice-selected',
            )}
            aria-checked={props.selectedChoiceID === choice().choice_id}
            data-flower-input-answer-kind="choice"
          />
        )}
      </FlowerKeyedList>
      <Show when={props.showCustomChoice}>
        <Button
          variant="ghost"
          size="sm"
          role="radio"
          disabled={props.disabled}
          class={cn(
            'flower-input-request-choice-custom rounded-full',
            props.customSelected && 'flower-input-request-choice-selected',
          )}
          aria-checked={props.customSelected}
          data-flower-input-answer-kind="custom"
          onClick={() => props.onSelectCustom()}
          onKeyDown={(event) => {
            if (event.key !== ' ') return;
            event.preventDefault();
            props.onSelectCustom();
          }}
        >
          <Pencil class="flower-input-request-choice-custom-icon h-4 w-4" aria-hidden="true" />
          <span class="flower-input-request-choice-label">
            {props.customLabel}
          </span>
        </Button>
      </Show>
    </RadioGroup>
  );
}
