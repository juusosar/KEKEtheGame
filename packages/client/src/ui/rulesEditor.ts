// The host rules editor: presets, then one row per rule (− value +) in collapsible groups. Used by the
// room setup menu (Play) and the lobby's Rules overlay. It only edits a local copy; the owner sends it.
import {
  RULE_GROUPS,
  changedRules,
  snapRule,
  type GameConfig,
  type HostRules,
  type RuleKey,
  type RuleSpec,
} from '@keke/shared';
import { t } from '../i18n';
import { h } from './dom';
import {
  PRESET_LABEL,
  PRESET_RULES,
  RULE_GROUP_LABEL,
  RULE_LABEL,
  RULE_PRESETS,
  formatRuleValue,
  fromInput,
  inputRange,
  matchingPreset,
  rulesIn,
  toInput,
  unitLabel,
  type RulePreset,
} from './rules';

export interface RulesEditorOptions {
  /** The values a rule the host leaves alone plays: the shipped config. */
  base: GameConfig;
  rules: HostRules;
  /** Read only: everyone but the host sees the values without controls that work. */
  readOnly?: boolean;
  /** Prefix for element ids, so two editors never share one. */
  idPrefix: string;
  onChange?: (rules: HostRules) => void;
}

interface Row {
  spec: RuleSpec;
  root: HTMLElement;
  input: HTMLInputElement;
  lower: HTMLButtonElement;
  raise: HTMLButtonElement;
}

export class RulesEditor {
  readonly root: HTMLDivElement;
  private readonly rows = new Map<RuleKey, Row>();
  private readonly presetButtons = new Map<RulePreset, HTMLButtonElement>();
  private values: Record<RuleKey, number>;

  constructor(private readonly opts: RulesEditorOptions) {
    this.values = this.valuesFor(opts.rules);
    this.root = h('div', { class: 'rules-editor', 'data-readonly': String(opts.readOnly === true) });

    const presets = h('div', { class: 'choice', role: 'group', 'aria-label': t('rules.presetLabel') });
    for (const preset of RULE_PRESETS) {
      const button = h('button', { type: 'button', 'data-preset': preset }, t(PRESET_LABEL[preset]));
      button.addEventListener('click', () => this.set(PRESET_RULES[preset]));
      button.disabled = opts.readOnly === true;
      this.presetButtons.set(preset, button);
      presets.append(button);
    }
    this.root.append(h('label', {}, t('rules.presetLabel')), presets);

    for (const group of RULE_GROUPS) {
      const details = h('details', { class: 'rules-group', 'data-group': group });
      if (group === 'round' || group === 'race') details.open = true;
      details.append(h('summary', {}, t(RULE_GROUP_LABEL[group])));
      for (const spec of rulesIn(group)) details.append(this.row(spec));
      this.root.append(details);
    }
    this.render();
  }

  /** The rules as edited: only values that differ from `base`. */
  get rules(): HostRules {
    return changedRules(this.opts.base, this.values);
  }

  /** Replaces every value (a preset, the room's rules arriving); keys not in `rules` go back to base. */
  set(rules: HostRules): void {
    this.values = this.valuesFor(rules);
    this.render();
    this.opts.onChange?.(this.rules);
  }

  private valuesFor(rules: HostRules): Record<RuleKey, number> {
    const values = {} as Record<RuleKey, number>;
    for (const group of RULE_GROUPS) {
      for (const spec of rulesIn(group)) values[spec.key] = rules[spec.key] ?? this.opts.base[spec.key];
    }
    return values;
  }

  private row(spec: RuleSpec): HTMLElement {
    const id = `${this.opts.idPrefix}-${spec.key}`;
    const label = t(RULE_LABEL[spec.key]);
    const range = inputRange(spec);
    const input = h('input', {
      type: 'number',
      id,
      min: range.min,
      max: range.max,
      step: range.step,
      inputmode: 'decimal',
      'data-rule-input': spec.key,
    });
    input.readOnly = this.opts.readOnly === true;
    const lower = h(
      'button',
      { type: 'button', class: 'step', 'aria-label': t('rules.lower', { rule: label }) },
      '−',
    );
    const raise = h(
      'button',
      { type: 'button', class: 'step', 'aria-label': t('rules.raise', { rule: label }) },
      '+',
    );
    lower.addEventListener('click', () => this.nudge(spec, -1));
    raise.addEventListener('click', () => this.nudge(spec, 1));
    input.addEventListener('change', () => this.typed(spec, input.value));
    const root = h(
      'div',
      { class: 'rule', 'data-rule': spec.key },
      h('label', { for: id }, label),
      h('span', { class: 'rule-input' }, lower, input, raise, h('span', { class: 'unit' }, unitLabel(spec))),
      h(
        'span',
        { class: 'rule-standard muted' },
        t('rules.standard', { value: formatRuleValue(spec, this.opts.base[spec.key]) }),
      ),
    );
    this.rows.set(spec.key, { spec, root, input, lower, raise });
    return root;
  }

  private nudge(spec: RuleSpec, direction: 1 | -1): void {
    this.update(spec, snapRule(spec, this.values[spec.key] + direction * spec.step));
  }

  private typed(spec: RuleSpec, text: string): void {
    const shown = Number(text);
    this.update(
      spec,
      Number.isFinite(shown) && text.trim() !== ''
        ? snapRule(spec, fromInput(spec, shown))
        : this.values[spec.key],
    );
  }

  private update(spec: RuleSpec, value: number): void {
    this.values[spec.key] = value;
    this.render();
    this.opts.onChange?.(this.rules);
  }

  private render(): void {
    const readOnly = this.opts.readOnly === true;
    for (const { spec, root, input, lower, raise } of this.rows.values()) {
      const value = this.values[spec.key];
      input.value = String(toInput(spec, value));
      root.dataset['changed'] = String(Math.abs(value - this.opts.base[spec.key]) > 1e-9);
      lower.disabled = readOnly || value <= spec.min;
      raise.disabled = readOnly || value >= spec.max;
    }
    const preset = matchingPreset(this.opts.base, this.values);
    for (const [name, button] of this.presetButtons)
      button.setAttribute('aria-pressed', String(preset === name));
  }
}
