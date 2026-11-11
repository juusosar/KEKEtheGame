import { loadConfig } from '@keke/shared';
import Phaser from 'phaser';
import { t } from '../i18n';
import { browserStorage, loadProfile } from '../profile/storage';
import { createMenuLayer } from '../ui/dom';
import { HowToPlay } from '../ui/howToPlay';

/** The How to play screen off the title menu: the illustrated pages, then back to the title. */
export class HowToScene extends Phaser.Scene {
  constructor() {
    super('HowTo');
  }

  create(): void {
    const layer = createMenuLayer(this, 'howto');
    const { profile } = loadProfile(browserStorage(), loadConfig().nicknameMaxLength);
    const howTo = new HowToPlay({
      variant: 'page',
      closeLabel: t('howto.back'),
      doneLabel: t('howto.done'),
      look: { color: profile.color, hat: profile.hat },
      onClose: () => this.scene.start('Title', { focus: 'howTo' }),
    });
    layer.append(howTo.root);
    howTo.focus();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => howTo.destroy());
  }
}
