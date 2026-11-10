import { HAT_IDS, PLAYER_COLORS, loadConfig, type GameConfig, type PlayerProfile } from '@keke/shared';
import Phaser from 'phaser';
import { createManifestAnimations, preloadManifestAssets } from '../game/assets';
import { animKey } from '../game/facing';
import { renderConfig } from '../game/renderConfig';
import { t, type MessageKey } from '../i18n';
import { browserStorage, loadProfile, saveProfile } from '../profile/storage';
import { createMenuLayer, h } from '../ui/dom';

/**
 * §13.1 step 2: nickname, colour and hat, saved in localStorage. A live preview of the tinted body and
 * hat stands next to the form. Continue saves and goes to Play; Back returns to the title.
 */
export class ProfileScene extends Phaser.Scene {
  private config!: GameConfig;
  private profile!: PlayerProfile;
  private body!: Phaser.GameObjects.Sprite;
  private hat!: Phaser.GameObjects.Sprite;
  private name!: Phaser.GameObjects.Text;

  constructor() {
    super('Profile');
  }

  preload(): void {
    preloadManifestAssets(this);
  }

  create(): void {
    this.config = loadConfig();
    this.profile = loadProfile(browserStorage(), this.config.nicknameMaxLength).profile;
    createManifestAnimations(this);
    this.createPreview();
    this.createForm();
  }

  override update(): void {
    // The hat overlay shows the body's current frame, as in the Game scene.
    this.hat.setFrame(this.body.frame.name);
  }

  private createPreview(): void {
    const scale = renderConfig.menuPreviewScale;
    this.body = this.add.sprite(0, 0, 'body').setScale(scale);
    this.hat = this.add.sprite(0, 0, `hat_${this.profile.hat}`).setScale(scale);
    this.body.play(animKey('body', false, 'down'));
    this.name = this.add
      .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#f2f2f2' })
      .setOrigin(0.5, 0);
    const layout = (): void => {
      const { width, height } = this.scale;
      // Beside the form on wide screens; hidden behind it on narrow ones, where the form fills the width.
      const x = width >= 760 ? width * 0.3 : width / 2;
      const y = width >= 760 ? height / 2 : height * 0.15;
      this.body.setPosition(x, y);
      this.hat.setPosition(x, y);
      this.name.setPosition(x, y + 20 * scale);
      const visible = width >= 760;
      this.body.setVisible(visible);
      this.hat.setVisible(visible);
      this.name.setVisible(visible);
    };
    layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, layout));
    this.refreshPreview();
  }

  private refreshPreview(): void {
    this.body.setTint(Phaser.Display.Color.HexStringToColor(this.profile.color).color);
    this.hat.setTexture(`hat_${this.profile.hat}`, this.body.frame.name);
    this.name.setText(this.profile.nickname);
  }

  private createForm(): void {
    const layer = createMenuLayer(this, 'profile');
    const form = h('form', { class: 'panel side', 'aria-labelledby': 'keke-profile-heading' });
    form.append(h('h2', { id: 'keke-profile-heading' }, t('profile.heading')));

    const nickname = h('input', {
      type: 'text',
      id: 'keke-nickname',
      name: 'nickname',
      maxlength: this.config.nicknameMaxLength,
      autocomplete: 'nickname',
      spellcheck: false,
      value: this.profile.nickname,
    });
    nickname.addEventListener('input', () => {
      this.profile = { ...this.profile, nickname: nickname.value };
      this.name.setText(nickname.value.trim());
    });
    form.append(h('label', { for: 'keke-nickname' }, t('profile.nickname')), nickname);

    const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': t('profile.color') });
    for (const color of PLAYER_COLORS) {
      const swatch = h('button', {
        type: 'button',
        class: 'swatch',
        'aria-label': t('profile.colorOption', { color }),
        'aria-pressed': color === this.profile.color,
        'data-color': color,
      });
      swatch.style.background = color;
      swatch.addEventListener('click', () => {
        this.profile = { ...this.profile, color };
        for (const other of swatches.children) other.setAttribute('aria-pressed', String(other === swatch));
        this.refreshPreview();
      });
      swatches.append(swatch);
    }
    form.append(h('label', {}, t('profile.color')), swatches);

    const hats = h('div', { class: 'hats', role: 'group', 'aria-label': t('profile.hat') });
    for (const hat of HAT_IDS) {
      const button = h(
        'button',
        { type: 'button', 'aria-pressed': hat === this.profile.hat, 'data-hat': hat },
        t(`hat.${hat}` as MessageKey),
      );
      button.addEventListener('click', () => {
        this.profile = { ...this.profile, hat };
        for (const other of hats.children) other.setAttribute('aria-pressed', String(other === button));
        this.refreshPreview();
      });
      hats.append(button);
    }
    form.append(h('label', {}, t('profile.hat')), hats);

    const back = h('button', { type: 'button', class: 'secondary' }, t('profile.back'));
    back.addEventListener('click', () => this.scene.start('Title'));
    const next = h('button', { type: 'submit' }, t('profile.continue'));
    form.append(h('div', { class: 'actions' }, back, next));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.profile = saveProfile(browserStorage(), this.profile, this.config.nicknameMaxLength);
      this.scene.start('Play');
    });

    layer.append(form);
    nickname.focus();
    nickname.select();
  }
}
