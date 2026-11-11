import { defaultThemeId, getTheme } from '@keke/shared';
import Phaser from 'phaser';
import { t } from '../i18n';
import { createMenuLayer, h } from '../ui/dom';
import { PAD_MENU } from '../ui/menuNav';

/** The game's logo (public/assets/logo.svg, also the browser tab icon), rasterised once at LOGO_TEXTURE_PX. */
const LOGO_KEY = 'logo';
const LOGO_TEXTURE_PX = 512;
/** Largest size the logo is drawn at on the title screen. */
const LOGO_MAX_PX = 240;

/** Data the Title scene accepts: which button to focus (the How to play screen returns to its button). */
export interface TitleSceneData {
  focus?: 'play' | 'howTo';
}

/**
 * §13.1 step 1: the title screen. Play (click, Enter, Space or gamepad A) goes to the Profile screen;
 * How to play opens the illustrated pages (HowTo scene). Pad D-pad up/down moves between the two.
 */
export class TitleScene extends Phaser.Scene {
  private leaving = false;
  private focusOn: TitleSceneData['focus'] = 'play';

  constructor() {
    super('Title');
  }

  init(data: TitleSceneData | undefined): void {
    this.focusOn = data?.focus ?? 'play';
  }

  preload(): void {
    if (!this.textures.exists(LOGO_KEY)) {
      this.load.svg(LOGO_KEY, 'assets/logo.svg', { width: LOGO_TEXTURE_PX, height: LOGO_TEXTURE_PX });
    }
  }

  create(): void {
    this.leaving = false;
    const theme = getTheme(defaultThemeId);

    const logo = this.add.image(0, 0, LOGO_KEY).setOrigin(0.5);
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
      const size = Math.max(96, Math.min(LOGO_MAX_PX, width * 0.5, height * 0.32));
      logo.setPosition(width / 2, height * 0.3);
      logo.setDisplaySize(size, size);
      tagline.setPosition(width / 2, height * 0.3 + size / 2 + 36);
      tagline.setWordWrapWidth(Math.max(200, width - 32));
    };
    layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, layout));

    const layer = createMenuLayer(this, 'title');
    const play = h('button', { type: 'button' }, t('title.play'));
    play.addEventListener('click', () => this.next());
    const howTo = h(
      'button',
      { type: 'button', class: 'secondary', id: 'keke-title-howto' },
      t('title.howTo'),
    );
    howTo.addEventListener('click', () => this.go('HowTo'));
    layer.append(
      h('div', { class: 'title-actions' }, play, howTo, h('p', { class: 'muted' }, t('title.hint'))),
    );
    (this.focusOn === 'howTo' ? howTo : play).focus();

    // Enter and Space start the game unless focus sits on another button (it then presses that one).
    const onKey = (event: KeyboardEvent): void => {
      if (event.target === howTo) return;
      this.next();
    };
    this.input.keyboard?.on('keydown-ENTER', onKey);
    this.input.keyboard?.on('keydown-SPACE', onKey);
    this.input.gamepad?.on(
      'down',
      (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
        if (button.index === PAD_MENU.a) {
          if (document.activeElement === howTo) this.go('HowTo');
          else this.next();
        } else if (button.index === PAD_MENU.up || button.index === PAD_MENU.down) {
          (document.activeElement === howTo ? play : howTo).focus();
        }
      },
    );
  }

  private next(): void {
    this.go('Profile');
  }

  private go(scene: 'Profile' | 'HowTo'): void {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start(scene);
  }
}
