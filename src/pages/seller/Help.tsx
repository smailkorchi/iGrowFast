import { HelpCircle, Mail, MessageSquare, Phone } from 'lucide-react';

const SellerHelp = () => {
    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <header className="space-y-2">
                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                        Support · Commercial
                    </div>
                    <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                        Aide
                    </h1>
                    <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                        Guides, FAQ et canaux de support — ils arrivent. En attendant, voici les manières les plus rapides de joindre l&apos;équipe.
                    </p>
                </header>

                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-8 md:p-10 flex flex-col items-center justify-center gap-4 text-center">
                        <div className="h-12 w-12 rounded-xl border border-ant-line bg-ant-light flex items-center justify-center">
                            <HelpCircle className="w-5 h-5 text-ant-mid" strokeWidth={1.5} />
                        </div>
                        <div className="space-y-1 max-w-md">
                            <h2 className="font-display text-[18px] font-semibold text-ant-ink">Centre d&apos;aide en préparation</h2>
                            <p className="font-serif italic text-[13px] text-ant-mid">
                                Tutoriels, captures d&apos;écran, raccourcis clavier, guides de mise en route — tout sera centralisé ici.
                            </p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/25 bg-ant-orange/10 px-2 py-0.5 text-[10px] font-semibold text-ant-orange">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange animate-pulse" />
                            En développement
                        </span>
                    </div>
                </section>

                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="font-display text-ant-orange font-semibold">01</span>
                                Canaux d&apos;entraide
                            </div>
                            <span className="font-serif italic text-[11px] text-ant-mid">réponse sous 24 h ouvrées</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                            {[
                                {
                                    icon: Mail,
                                    label: 'Email',
                                    value: 'support@igrowfast.ma',
                                    note: 'Demandes écrites',
                                    href: 'mailto:support@igrowfast.ma',
                                    tone: 'bg-ant-ink border-ant-ink/15 text-ant-ink',
                                },
                                {
                                    icon: Phone,
                                    label: 'Téléphone',
                                    value: 'Demandez à votre référent',
                                    note: 'Urgences opérationnelles',
                                    href: undefined,
                                    tone: 'bg-ant-orange border-ant-orange/25 text-ant-orange',
                                },
                                {
                                    icon: MessageSquare,
                                    label: 'Demandes internes',
                                    value: 'Onglet Demands',
                                    note: 'Suivi, historique, pièces jointes',
                                    href: '/seller/demands',
                                    tone: 'bg-ant-green border-ant-green/25 text-ant-green',
                                },
                            ].map((c) => {
                                const Icon = c.icon;
                                const content = (
                                    <>
                                        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                            <span className={`h-1.5 w-1.5 rounded-full ${c.tone.split(' ')[0]}/100 ${c.tone.split(' ')[0]}`} />
                                            {c.label}
                                        </div>
                                        <p className="font-display text-[14px] font-semibold text-ant-ink mt-1 truncate">{c.value}</p>
                                        <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{c.note}</p>
                                    </>
                                );
                                return (
                                    <div key={c.label} className="bg-ant-paper p-4 relative flex items-start gap-3">
                                        <div className={`h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 ${c.tone.replace('bg-ant-ink ', 'bg-ant-ink/10 ').replace('bg-ant-orange ', 'bg-ant-orange/10 ').replace('bg-ant-green ', 'bg-ant-green/10 ')}`}>
                                            <Icon className="w-4 h-4" strokeWidth={1.75} />
                                        </div>
                                        <div className="min-w-0 flex-1">{content}</div>
                                        {c.href && (
                                            <a
                                                href={c.href}
                                                className="absolute inset-0"
                                                aria-label={`Ouvrir ${c.label}`}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default SellerHelp;
