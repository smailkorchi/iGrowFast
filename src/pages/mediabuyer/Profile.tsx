import { ProfileScaffold } from '@/components/profile/ProfileScaffold';
import { BankDetailsCard } from '@/components/profile/BankDetailsCard';

const fmtMAD = (n: unknown) =>
    n === null || n === undefined || Number(n) === 0 ? '—'
        : new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) + ' MAD';

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">{label}</p>
        <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">{value}</p>
    </div>
);

const MediaBuyerProfile = () => (
    <ProfileScaffold
        roleLabel="Media Buyer"
        securityChapter="04"
        extra={(p) => (
            <>
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[2px] w-full bg-ant-orange/70" />
                    <div className="px-5 md:px-6 pt-5 pb-3">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                            <span className="font-display text-ant-orange font-semibold">02</span> Rémunération
                        </div>
                    </div>
                    <div className="px-5 md:px-6 pb-6 grid grid-cols-2 gap-4">
                        <Field label="Type de paiement" value={p?.payment_type === 'salary' ? 'Salaire' : 'Commission'} />
                        {p?.payment_type === 'salary'
                            ? <Field label="Salaire mensuel" value={fmtMAD(p?.salary_amount)} />
                            : <Field label="Commission / commande" value={fmtMAD(p?.commission_price)} />}
                    </div>
                </section>
                <BankDetailsCard profile={p} currentUserId={p?.id ?? null} chapter="03" />
            </>
        )}
    />
);

export default MediaBuyerProfile;
