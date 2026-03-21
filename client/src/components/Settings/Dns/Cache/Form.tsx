import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import i18next from 'i18next';
import { clearDnsCache } from '../../../../actions/dnsConfig';
import {
    CACHE_CONFIG_FIELDS,
    CACHE_OPTIMISTIC_PREFETCH_KEEP_DAYS,
    CACHE_OPTIMISTIC_PREFETCH_MODES,
    UINT32_RANGE,
} from '../../../../helpers/constants';
import { replaceZeroWithEmptyString } from '../../../../helpers/helpers';
import { RootState } from '../../../../initialState';
import { Checkbox } from '../../../ui/Controls/Checkbox';

const INPUTS_FIELDS = [
    {
        name: CACHE_CONFIG_FIELDS.cache_size,
        title: i18next.t('cache_size'),
        description: i18next.t('cache_size_desc'),
        placeholder: i18next.t('enter_cache_size'),
    },
    {
        name: CACHE_CONFIG_FIELDS.cache_ttl_min,
        title: i18next.t('cache_ttl_min_override'),
        description: i18next.t('cache_ttl_min_override_desc'),
        placeholder: i18next.t('enter_cache_ttl_min_override'),
    },
    {
        name: CACHE_CONFIG_FIELDS.cache_ttl_max,
        title: i18next.t('cache_ttl_max_override'),
        description: i18next.t('cache_ttl_max_override_desc'),
        placeholder: i18next.t('enter_cache_ttl_max_override'),
    },
];

type FormData = {
    cache_enabled: boolean;
    cache_size: number;
    cache_ttl_min: number;
    cache_ttl_max: number;
    cache_optimistic: boolean;
    cache_optimistic_prefetch_mode: string;
    cache_optimistic_prefetch_keep_days: number;
};

type CacheFormProps = {
    initialValues?: Partial<FormData>;
    onSubmit: (data: FormData) => void;
};

const Form = ({ initialValues, onSubmit }: CacheFormProps) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const { processingSetConfig } = useSelector((state: RootState) => state.dnsConfig);

    const {
        register,
        handleSubmit,
        watch,
        control,
        formState: { isSubmitting },
    } = useForm<FormData>({
        mode: 'onBlur',
        defaultValues: {
            cache_enabled: initialValues?.cache_enabled || false,
            cache_size: initialValues?.cache_size || 0,
            cache_ttl_min: initialValues?.cache_ttl_min || 0,
            cache_ttl_max: initialValues?.cache_ttl_max || 0,
            cache_optimistic: initialValues?.cache_optimistic || false,
            cache_optimistic_prefetch_mode:
                initialValues?.cache_optimistic_prefetch_mode || CACHE_OPTIMISTIC_PREFETCH_MODES.all,
            cache_optimistic_prefetch_keep_days: initialValues?.cache_optimistic_prefetch_keep_days || 5,
        },
    });

    const cache_enabled = watch('cache_enabled');
    const cache_size = watch('cache_size');
    const cache_ttl_min = watch('cache_ttl_min');
    const cache_ttl_max = watch('cache_ttl_max');
    const cache_optimistic = watch('cache_optimistic');

    const minExceedsMax = cache_ttl_min > 0 && cache_ttl_max > 0 && cache_ttl_min > cache_ttl_max;
    const cacheSizeZeroWhenEnabled = cache_enabled && cache_size === 0;

    const handleClearCache = () => {
        if (window.confirm(t('confirm_dns_cache_clear'))) {
            dispatch(clearDnsCache());
        }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)}>
            <div className="row">
                <div className="col-12 col-md-7">
                    <div className="form__group form__group--settings">
                        <Controller
                            name="cache_enabled"
                            control={control}
                            render={({ field }) => (
                                <Checkbox
                                    {...field}
                                    data-testid="dns_cache_enabled"
                                    title={t('cache_enabled')}
                                    subtitle={t('cache_enabled_desc')}
                                    disabled={processingSetConfig}
                                />
                            )}
                        />
                    </div>
                </div>

                {INPUTS_FIELDS.map(({ name, title, description, placeholder }) => (
                    <div className="col-12" key={name}>
                        <div className="col-12 col-md-7 p-0">
                            <div className="form__group form__group--settings">
                                <label htmlFor={name} className="form__label form__label--with-desc">
                                    {title}
                                </label>

                                <div className="form__desc form__desc--top">{description}</div>

                                <input
                                    type="number"
                                    data-testid={`dns_${name}`}
                                    className="form-control"
                                    placeholder={placeholder}
                                    disabled={processingSetConfig}
                                    min={0}
                                    max={UINT32_RANGE.MAX}
                                    {...register(name as keyof FormData, {
                                        valueAsNumber: true,
                                        setValueAs: (value) => replaceZeroWithEmptyString(value),
                                    })}
                                />

                                {name === CACHE_CONFIG_FIELDS.cache_size && cacheSizeZeroWhenEnabled && (
                                    <span className="form__message form__message--error">
                                        {t('cache_size_validation')}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                {minExceedsMax && <span className="text-danger pl-3 pb-3">{t('ttl_cache_validation')}</span>}
            </div>

            <div className="row">
                <div className="col-12 col-md-7">
                    <div className="form__group form__group--settings">
                        <Controller
                            name="cache_optimistic"
                            control={control}
                            render={({ field }) => (
                                <Checkbox
                                    {...field}
                                    data-testid="dns_cache_optimistic"
                                    title={t('cache_optimistic')}
                                    subtitle={t('cache_optimistic_desc')}
                                    disabled={processingSetConfig}
                                />
                            )}
                        />
                    </div>
                </div>
            </div>

            {cache_optimistic && (
                <div className="row">
                    <div className="col-12 col-md-7">
                        <div className="form__group form__group--settings">
                            <label
                                htmlFor={CACHE_CONFIG_FIELDS.cache_optimistic_prefetch_mode}
                                className="form__label form__label--with-desc">
                                {t('cache_optimistic_prefetch_mode')}
                            </label>
                            <div className="form__desc form__desc--top">{t('cache_optimistic_prefetch_mode_desc')}</div>
                            <select
                                id={CACHE_CONFIG_FIELDS.cache_optimistic_prefetch_mode}
                                data-testid="dns_cache_optimistic_prefetch_mode"
                                className="form-control custom-select"
                                disabled={processingSetConfig}
                                {...register('cache_optimistic_prefetch_mode')}>
                                <option value={CACHE_OPTIMISTIC_PREFETCH_MODES.all}>
                                    {t('cache_optimistic_prefetch_all')}
                                </option>
                                <option value={CACHE_OPTIMISTIC_PREFETCH_MODES.hits_2_per_hour}>
                                    {t('cache_optimistic_prefetch_hits_2')}
                                </option>
                                <option value={CACHE_OPTIMISTIC_PREFETCH_MODES.hits_5_per_hour}>
                                    {t('cache_optimistic_prefetch_hits_5')}
                                </option>
                            </select>

                            <label
                                htmlFor={CACHE_CONFIG_FIELDS.cache_optimistic_prefetch_keep_days}
                                className="form__label form__label--with-desc mt-3">
                                {t('cache_optimistic_prefetch_keep_days')}
                            </label>
                            <div className="form__desc form__desc--top">
                                {t('cache_optimistic_prefetch_keep_days_desc')}
                            </div>
                            <select
                                id={CACHE_CONFIG_FIELDS.cache_optimistic_prefetch_keep_days}
                                data-testid="dns_cache_optimistic_prefetch_keep_days"
                                className="form-control custom-select"
                                disabled={processingSetConfig}
                                {...register('cache_optimistic_prefetch_keep_days', {
                                    setValueAs: (value) => Number(value),
                                })}>
                                {CACHE_OPTIMISTIC_PREFETCH_KEEP_DAYS.map((days) => (
                                    <option key={days} value={days}>
                                        {t(`cache_optimistic_prefetch_keep_days_${days}`)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            <button
                type="submit"
                data-testid="dns_save"
                className="btn btn-success btn-standard btn-large"
                disabled={isSubmitting || processingSetConfig || minExceedsMax || cacheSizeZeroWhenEnabled}>
                {t('save_btn')}
            </button>

            <button
                type="button"
                data-testid="dns_clear"
                className="btn btn-outline-secondary btn-standard form__button"
                onClick={handleClearCache}>
                {t('clear_cache')}
            </button>
        </form>
    );
};

export default Form;
