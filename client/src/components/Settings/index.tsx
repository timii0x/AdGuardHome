import React, { Component, Fragment } from 'react';
import { Trans, withTranslation } from 'react-i18next';

import i18next from 'i18next';
import StatsConfig from './StatsConfig';

import LogsConfig from './LogsConfig';

import { FiltersConfig } from './FiltersConfig';

import { Checkbox } from '../ui/Controls/Checkbox';

import Loading from '../ui/Loading';

import PageTitle from '../ui/PageTitle';

import Card from '../ui/Card';

import { getObjectKeysSorted, captitalizeWords } from '../../helpers/helpers';
import './Settings.css';
import { SettingsData } from '../../initialState';

const ORDER_KEY = 'order';

const SETTINGS = {
    safebrowsing: {
        enabled: false,
        title: i18next.t('use_adguard_browsing_sec'),
        subtitle: i18next.t('use_adguard_browsing_sec_hint'),
        testId: 'safebrowsing',
        [ORDER_KEY]: 0,
    },
    parental: {
        enabled: false,
        title: i18next.t('use_adguard_parental'),
        subtitle: i18next.t('use_adguard_parental_hint'),
        testId: 'parental',
        [ORDER_KEY]: 1,
    },
};

interface SettingsProps {
    initSettings: (...args: unknown[]) => unknown;
    settings: SettingsData;
    toggleSetting: (...args: unknown[]) => unknown;
    getStatsConfig: (...args: unknown[]) => unknown;
    setStatsConfig: (...args: unknown[]) => unknown;
    resetStats: (...args: unknown[]) => unknown;
    setFiltersConfig: (...args: unknown[]) => unknown;
    getFilteringStatus: (...args: unknown[]) => unknown;
    getUpdate: (...args: unknown[]) => unknown;
    getCustomUpdate: (...args: unknown[]) => unknown;
    getCustomUpdateStatus: (...args: unknown[]) => unknown;
    getVersion: (...args: unknown[]) => unknown;
    t: (...args: unknown[]) => string;
    getLogsConfig?: (...args: unknown[]) => unknown;
    setLogsConfig?: (...args: unknown[]) => unknown;
    clearLogs?: (...args: unknown[]) => unknown;
    stats?: {
        processingGetConfig?: boolean;
        interval?: number;
        customInterval?: number;
        enabled?: boolean;
        ignored?: unknown[];
        ignored_enabled?: boolean;
        processingSetConfig?: boolean;
        processingReset?: boolean;
    };
    queryLogs?: {
        enabled?: boolean;
        interval?: number;
        customInterval?: number;
        anonymize_client_ip?: boolean;
        processingSetConfig?: boolean;
        processingClear?: boolean;
        processingGetConfig?: boolean;
        ignored?: unknown[];
        ignored_enabled?: boolean;
    };
    filtering?: {
        interval?: number;
        enabled?: boolean;
        processingSetConfig?: boolean;
    };
    dashboard?: {
        dnsVersion?: string;
        isUpdateAvailable?: boolean;
        newVersion?: string;
        canAutoUpdate?: boolean;
        processingVersion?: boolean;
        processingUpdate?: boolean;
        processingCustomUpdateStatus?: boolean;
        customUpdateForkConfigured?: boolean;
        customUpdateBuildVersion?: string;
        customUpdateInstalledRevision?: string;
        customUpdateRemoteRevision?: string;
        customUpdateAvailable?: boolean;
        customUpdateStatusError?: string;
    };
}

class Settings extends Component<SettingsProps> {
    componentDidMount() {
        this.props.initSettings(SETTINGS);

        this.props.getStatsConfig();

        this.props.getLogsConfig();

        this.props.getFilteringStatus();
    }

    renderSettings = (settings: any) =>
        getObjectKeysSorted(SETTINGS, ORDER_KEY).map((key: any) => {
            const setting = settings[key];
            const { enabled, title, subtitle, testId } = setting;

            return (
                <div key={key} className="form__group form__group--checkbox">
                    <Checkbox
                        data-testid={testId}
                        value={enabled}
                        title={title}
                        subtitle={subtitle}
                        onChange={(checked) => this.props.toggleSetting(key, !checked)}
                    />
                </div>
            );
        });

    renderSafeSearch = () => {
        const {
            settings: {
                settingsList: { safesearch },
            },
        } = this.props;
        const { enabled } = safesearch || {};
        const searches = { ...(safesearch || {}) };
        delete searches.enabled;

        return (
            <>
                <div className="form__group form__group--checkbox">
                    <Checkbox
                        data-testid="safesearch"
                        value={enabled}
                        title={i18next.t('enforce_safe_search')}
                        subtitle={i18next.t('enforce_save_search_hint')}
                        onChange={(checked) =>
                            this.props.toggleSetting('safesearch', { ...safesearch, enabled: checked })
                        }
                    />
                </div>

                <div className="form__group--inner">
                    {Object.keys(searches).map((searchKey) => (
                        <div key={searchKey} className="form__group form__group--checkbox">
                            <Checkbox
                                value={searches[searchKey]}
                                title={captitalizeWords(searchKey)}
                                disabled={!safesearch.enabled}
                                onChange={(checked) =>
                                    this.props.toggleSetting('safesearch', { ...safesearch, [searchKey]: checked })
                                }
                            />
                        </div>
                    ))}
                </div>
            </>
        );
    };

    render() {
        const {
            settings,
            setStatsConfig,
            resetStats,
            stats,
            queryLogs,
            setLogsConfig,
            clearLogs,
            filtering,
            setFiltersConfig,
            getUpdate,
            getCustomUpdate,
            getCustomUpdateStatus,
            getVersion,
            dashboard,
            t,
        } = this.props;

        const isDataReady = !settings.processing && !stats.processingGetConfig && !queryLogs.processingGetConfig;
        const dnsVersion = dashboard?.dnsVersion || '-';
        const processingUpdate = !!dashboard?.processingUpdate;
        const processingVersion = !!dashboard?.processingVersion;
        const processingCustomUpdateStatus = !!dashboard?.processingCustomUpdateStatus;
        const processingCheckUpdates = processingVersion || processingCustomUpdateStatus;
        const aghUpdateAvailable = !!dashboard?.isUpdateAvailable;
        const aghCanAutoUpdate = !!dashboard?.canAutoUpdate;
        const aghLatestVersion = aghUpdateAvailable ? dashboard?.newVersion || '-' : dnsVersion;
        const aghStatus = aghUpdateAvailable ? t('agh_update_available') : t('agh_up_to_date');
        const forkConfigured = !!dashboard?.customUpdateForkConfigured;
        const forkBuildVersion = dashboard?.customUpdateBuildVersion || '-';
        const forkInstalledRevision = dashboard?.customUpdateInstalledRevision || '-';
        const forkRemoteRevision = dashboard?.customUpdateRemoteRevision || '-';
        const forkUpdateAvailable = !!dashboard?.customUpdateAvailable;
        const canRunCustomUpdate =
            forkConfigured && (forkUpdateAvailable || aghUpdateAvailable || !!dashboard?.customUpdateStatusError);
        const forkStatus = !forkConfigured
            ? t('custom_update_not_configured')
            : forkUpdateAvailable
              ? t('custom_update_available')
              : t('custom_update_up_to_date');

        return (
            <Fragment>
                <PageTitle title={t('general_settings')}>
                    <button
                        type="button"
                        className="btn btn-outline-primary btn-sm mr-2"
                        onClick={() => {
                            getVersion(true);
                            getCustomUpdateStatus(true);
                        }}
                        disabled={processingCheckUpdates}>
                        <Trans>check_updates_btn</Trans>
                    </button>
                    <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => getCustomUpdate()}
                        disabled={processingUpdate || !canRunCustomUpdate}>
                        <Trans>update_custom</Trans>
                    </button>
                    {aghUpdateAvailable && aghCanAutoUpdate && (
                        <button
                            type="button"
                            className="btn btn-primary btn-sm ml-2"
                            onClick={() => getUpdate()}
                            disabled={processingUpdate}>
                            <Trans>update_now</Trans>
                        </button>
                    )}
                </PageTitle>

                <div className="settings-update-meta">
                    <div>
                        <strong>AGH:</strong> {dnsVersion}
                    </div>
                    <div>
                        <strong>{t('agh_latest_version')}:</strong> {aghLatestVersion}
                    </div>
                    <div>
                        <strong>{t('status')}:</strong> {aghStatus}
                    </div>
                    {aghUpdateAvailable && !aghCanAutoUpdate && (
                        <div className="form__desc mt-1">{t('agh_use_custom_update_hint')}</div>
                    )}
                    <div>
                        <strong>{t('custom_fork_version')}:</strong> {forkBuildVersion}
                    </div>
                    <div>
                        <strong>{t('custom_fork_revision')}:</strong> {forkInstalledRevision}
                    </div>
                    <div>
                        <strong>{t('custom_fork_remote_version')}:</strong> {forkRemoteRevision}
                    </div>
                    <div>
                        <strong>{t('status')}:</strong> {forkStatus}
                    </div>
                    {dashboard?.customUpdateStatusError && (
                        <div className="form__desc mt-1">
                            {t('custom_update_status_error')}: {dashboard.customUpdateStatusError}
                        </div>
                    )}
                </div>

                {!isDataReady && <Loading />}

                {isDataReady && (
                    <div className="content">
                        <div className="row">
                            <div className="col-md-12">
                                <Card bodyType="card-body box-body--settings">
                                    <div className="form">
                                        <FiltersConfig
                                            initialValues={{
                                                interval: filtering.interval,
                                                enabled: filtering.enabled,
                                            }}
                                            processing={filtering.processingSetConfig}
                                            setFiltersConfig={setFiltersConfig}
                                        />
                                        {this.renderSettings(settings.settingsList)}
                                        {this.renderSafeSearch()}
                                    </div>
                                </Card>
                            </div>

                            <div className="col-md-12">
                                <LogsConfig
                                    enabled={queryLogs.enabled}
                                    ignored={queryLogs.ignored}
                                    ignoredEnabled={queryLogs.ignored_enabled}
                                    interval={queryLogs.interval}
                                    customInterval={queryLogs.customInterval}
                                    anonymize_client_ip={queryLogs.anonymize_client_ip}
                                    processing={queryLogs.processingSetConfig}
                                    processingClear={queryLogs.processingClear}
                                    setLogsConfig={setLogsConfig}
                                    clearLogs={clearLogs}
                                />
                            </div>

                            <div className="col-md-12">
                                <StatsConfig
                                    interval={stats.interval}
                                    customInterval={stats.customInterval}
                                    ignored={stats.ignored}
                                    ignoredEnabled={stats.ignored_enabled}
                                    enabled={stats.enabled}
                                    processing={stats.processingSetConfig}
                                    processingReset={stats.processingReset}
                                    setStatsConfig={setStatsConfig}
                                    resetStats={resetStats}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </Fragment>
        );
    }
}

export default withTranslation()(Settings);
