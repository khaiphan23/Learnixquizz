/**
 * Concurrency Module
 * Multi-tab coordination and version control
 */

export { versionControl, useVersionControl } from './VersionControl';
export type { VersionedEntity, PendingVersion } from './VersionControl';

export { tabCoordinator, useTabCoordinator } from './TabCoordinator';
export type { TabMessage } from './TabCoordinator';

export { requestSequencer, useRequestSequencer } from './RequestSequencer';
