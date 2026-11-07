import { CREDIT } from '../shared/credit';
import { installMemorySaver } from './memory';
import { mountAccountReporter } from './account';
import { mountPanel } from './panel';
import { mountCrmChatBar } from './crm-bridge';
import { mountComposer } from './composer';

document.documentElement.dataset.wwt = CREDIT.nickname;
installMemorySaver();
mountPanel();
mountAccountReporter();
mountCrmChatBar();
mountComposer();
