import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';

import { getCustomUpdateStatus, getVersion } from '../../actions';
import './Version.css';
import { RootState } from '../../initialState';

const Version = () => {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const dashboard = useSelector((state: RootState) => state.dashboard, shallowEqual);
    const install = useSelector((state: RootState) => state.install, shallowEqual);

    if (!dashboard && !install) {
        return null;
    }

    const version = dashboard?.dnsVersion || install?.dnsVersion;
    const forkVersion = dashboard?.customUpdateInstalledRevision || '-';
    const forkRemoteVersion = dashboard?.customUpdateRemoteRevision || '-';
    const isForkConfigured = !!dashboard?.customUpdateForkConfigured;

    const onClick = () => {
        dispatch(getVersion(true));
        dispatch(getCustomUpdateStatus(true));
    };

    return (
        <div className="version">
            <div className="version__text">
                {version && (
                    <>
                        <Trans>version</Trans>:&nbsp;
                        <span className="version__value" title={version}>
                            {version}
                        </span>
                    </>
                )}
                {dashboard && (
                    <>
                        &nbsp;|&nbsp;
                        {t('custom_fork_version')}:&nbsp;
                        <span className="version__value" title={forkVersion}>
                            {forkVersion}
                        </span>
                        {isForkConfigured && (
                            <>
                                &nbsp;|&nbsp;
                                {t('custom_fork_remote_version')}:&nbsp;
                                <span className="version__value" title={forkRemoteVersion}>
                                    {forkRemoteVersion}
                                </span>
                            </>
                        )}
                    </>
                )}

                {dashboard?.checkUpdateFlag && (
                    <button
                        type="button"
                        className="btn btn-icon btn-icon-sm btn-outline-primary btn-sm ml-2"
                        onClick={onClick}
                        disabled={dashboard?.processingVersion || dashboard?.processingCustomUpdateStatus}
                        title={t('check_updates_now')}>
                        <svg className="icons icon12">
                            <use xlinkHref="#refresh" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
};

export default Version;
