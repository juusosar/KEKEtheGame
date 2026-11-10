import { defaultThemeId, getTheme } from '@keke/shared';
import Phaser from 'phaser';
import { t } from '../i18n';
import { createMenuLayer, h } from '../ui/dom';

/** §13.1 step 1: the title screen. Play (click, Enter, Space or gamepad A) goes to the Profile screen. */
export class TitleScene extends Phaser.Scene {
  private leaving = false;

  constructor() {
    super('Title');
  }

  create(): void {
    this.leaving = false;
    const theme = getTheme(defaultThemeId);

    const logo = this.add
      .text(0, 0, 'KEKE', {
        fontFamily: 'Impact, "Arial Black", sans-serif',
        fontSize: '120px',
        color: theme.colors.primary,
        stroke: theme.colors.outline,
        strokeThickness: 12,
      })
      .setOrigin(0.5);
    const tagline = this.add
      .text(0, 0, t('title.tagline', { store: theme.brand.storeName }), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#f2f2f2',
        align: 'center',
      })
      .setOrigin(0.5);
    const layout = (): void => {
      const { width, height } = this.scale;
      logo.setPosition(width / 2, height * 0.36);
      logo.setScale(Math.min(1, width / 560));
      tagline.setPosition(width / 2, height * 0.36 + 90);
      tagline.setWordWrapWidth(Math.max(200, width - 32));
    };
    layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, layout));

    const layer = createMenuLayer(this, 'title');
    const play = h('button', { type: 'button' }, t('title.play'));
    play.addEventListener('click', () => this.next());
    layer.append(h('div', { class: 'title-actions' }, play, h('p', { class: 'muted' }, t('title.hint'))));
    play.focus();

    this.input.keyboard?.on('keydown-ENTER', () => this.next());
    this.input.keyboard?.on('keydown-SPACE', () => this.next());
    this.input.gamepad?.on(
      'down',
      (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
        if (button.index === 0) this.next();
      },
    );
  }

  private next(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start('Profile');
  }
}
