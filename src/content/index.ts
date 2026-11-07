import { CREDIT } from '../shared/credit';
import { installMemorySaver } from './memory';
import { mountAccountReporter } from './account';
import { mountPanel } from './panel';

document.documentElement.dataset.wwt = CREDIT.nickname;
installMemorySaver();
mountPanel();
mountAccountReporter();
