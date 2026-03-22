import { handleActions } from 'redux-actions';

import * as actions from '../actions';
import { isVersionAtLeast } from '../helpers/version';
import { STANDARD_DNS_PORT, STANDARD_WEB_PORT } from '../helpers/constants';

const dashboard = handleActions(
    {
        [actions.setDnsRunningStatus.toString()]: (state, { payload }: any) => ({
            ...state,
            isCoreRunning: payload,
        }),
        [actions.dnsStatusRequest.toString()]: (state: any) => ({
            ...state,
            processing: true,
        }),
        [actions.dnsStatusFailure.toString()]: (state: any) => ({
            ...state,
            processing: false,
        }),
        [actions.dnsStatusSuccess.toString()]: (state: any, { payload }: any) => {
            const {
                version,
                start_time: dnsStartTime,
                dns_port: dnsPort,
                dns_addresses: dnsAddresses,
                protection_enabled: protectionEnabled,
                protection_disabled_duration: protectionDisabledDuration,
                http_port: httpPort,
                language,
            } = payload;
            const newState = {
                ...state,
                isCoreRunning: true,
                processing: false,
                dnsVersion: version,
                dnsStartTime,
                dnsPort,
                dnsAddresses,
                protectionEnabled,
                protectionDisabledDuration,
                language,
                httpPort,
            };

            return newState;
        },
        [actions.timerStatusSuccess.toString()]: (state: any, { payload }: any) => {
            const { protection_enabled: protectionEnabled, protection_disabled_duration: protectionDisabledDuration } =
                payload;
            const newState = {
                ...state,
                protectionEnabled,
                protectionDisabledDuration,
            };

            return newState;
        },

        [actions.getVersionRequest.toString()]: (state: any) => ({
            ...state,
            processingVersion: true,
        }),
        [actions.getVersionFailure.toString()]: (state: any) => ({
            ...state,
            processingVersion: false,
        }),
        [actions.getVersionSuccess.toString()]: (state: any, { payload }: any) => {
            const currentVersion = state.dnsVersion === 'undefined' ? 0 : state.dnsVersion;

            if (!payload.disabled && !isVersionAtLeast(currentVersion, payload.new_version)) {
                const {
                    announcement_url: announcementUrl,
                    new_version: newVersion,
                    can_autoupdate: canAutoUpdate,
                } = payload;

                const newState = {
                    ...state,
                    announcementUrl,
                    newVersion,
                    canAutoUpdate,
                    isUpdateAvailable: true,
                    processingVersion: false,
                    checkUpdateFlag: !payload.disabled,
                };
                return newState;
            }

            const { can_autoupdate: canAutoUpdate } = payload || {};

            return {
                ...state,
                processingVersion: false,
                checkUpdateFlag: !payload.disabled,
                isUpdateAvailable: false,
                newVersion: '',
                announcementUrl: '',
                canAutoUpdate: !!canAutoUpdate,
            };
        },

        [actions.getUpdateRequest.toString()]: (state: any) => ({
            ...state,
            processingUpdate: true,
        }),
        [actions.getUpdateFailure.toString()]: (state: any) => ({
            ...state,
            processingUpdate: false,
        }),
        [actions.getUpdateSuccess.toString()]: (state: any) => {
            const newState = {
                ...state,
                processingUpdate: false,
            };
            return newState;
        },

        [actions.getCustomUpdateStatusRequest.toString()]: (state: any) => ({
            ...state,
            processingCustomUpdateStatus: true,
        }),
        [actions.getCustomUpdateStatusFailure.toString()]: (state: any) => ({
            ...state,
            processingCustomUpdateStatus: false,
        }),
        [actions.getCustomUpdateStatusSuccess.toString()]: (state: any, { payload }: any) => ({
            ...state,
            processingCustomUpdateStatus: false,
            customUpdateForkConfigured: !!payload?.fork_configured,
            customUpdateSourceDir: payload?.source_dir || '',
            customUpdateBranch: payload?.branch || '',
            customUpdateBuildVersion: payload?.build_version || '',
            customUpdateInstalledRevision: payload?.installed_revision || '',
            customUpdateRemoteRevision: payload?.remote_revision || '',
            customUpdateAvailable: !!payload?.update_available,
            customUpdateStatusError: payload?.error || '',
        }),

        [actions.toggleProtectionRequest.toString()]: (state: any) => ({
            ...state,
            processingProtection: true,
        }),
        [actions.toggleProtectionFailure.toString()]: (state: any) => ({
            ...state,
            processingProtection: false,
        }),
        [actions.toggleProtectionSuccess.toString()]: (state: any, { payload }: any) => {
            const newState = {
                ...state,
                protectionEnabled: !state.protectionEnabled,
                processingProtection: false,
                protectionDisabledDuration: payload.disabledDuration,
            };

            return newState;
        },

        [actions.setDisableDurationTime.toString()]: (state, { payload }: any) => ({
            ...state,
            protectionDisabledDuration: payload.timeToEnableProtection,
        }),

        [actions.getClientsRequest.toString()]: (state: any) => ({
            ...state,
            processingClients: true,
        }),
        [actions.getClientsFailure.toString()]: (state: any) => ({
            ...state,
            processingClients: false,
        }),
        [actions.getClientsSuccess.toString()]: (state: any, { payload }: any) => {
            const newState = {
                ...state,
                ...payload,
                processingClients: false,
            };
            return newState;
        },

        [actions.getProfileRequest.toString()]: (state: any) => ({
            ...state,
            processingProfile: true,
        }),
        [actions.getProfileFailure.toString()]: (state: any) => ({
            ...state,
            processingProfile: false,
        }),
        [actions.getProfileSuccess.toString()]: (state, { payload }: any) => ({
            ...state,
            name: payload.name,
            theme: payload.theme,
            processingProfile: false,
        }),
        [actions.changeThemeSuccess.toString()]: (state, { payload }: any) => ({
            ...state,
            theme: payload.theme,
        }),
    },
    {
        processing: true,
        isCoreRunning: true,
        processingVersion: true,
        processingClients: true,
        processingUpdate: false,
        processingCustomUpdateStatus: false,
        processingProfile: true,
        protectionEnabled: false,
        protectionDisabledDuration: null,
        protectionCountdownActive: false,
        processingProtection: false,
        httpPort: STANDARD_WEB_PORT,
        dnsPort: STANDARD_DNS_PORT,
        dnsAddresses: [],
        dnsVersion: '',
        dnsStartTime: null,
        clients: [],
        autoClients: [],
        supportedTags: [],
        name: '',
        theme: undefined,
        checkUpdateFlag: false,
        customUpdateForkConfigured: false,
        customUpdateSourceDir: '',
        customUpdateBranch: '',
        customUpdateBuildVersion: '',
        customUpdateInstalledRevision: '',
        customUpdateRemoteRevision: '',
        customUpdateAvailable: false,
        customUpdateStatusError: '',
    },
);

export default dashboard;
