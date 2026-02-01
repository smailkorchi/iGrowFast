const renderNoteCard = (note: any, type: 'company' | 'courier') => {
    // Get provider info and brand color
    const provider = note.providers;
    const providerType = provider?.provider_type?.toLowerCase();
    const brandColor = providerType === 'coliaty' ? 'emerald' : providerType === 'ameex' ? 'orange' : 'blue';

    return (
        <Card key={note.id} className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]">
            {/* Provider brand color accent */}
            <div className={`absolute top-0 left-0 w-full h-1.5 ${brandColor === 'emerald' ? 'bg-emerald-500' :
                    brandColor === 'orange' ? 'bg-orange-500' :
                        'bg-blue-500'
                }`} />

            <CardContent className="p-8 space-y-6">
                {/* Header with provider logo */}
                <div className="flex justify-between items-start gap-4">
                    <div className="flex items-center gap-4 flex-1">
                        {/* Provider Logo */}
                        {provider?.logo_url ? (
                            <div className={`p-3 rounded-2xl border-2 ${brandColor === 'emerald' ? 'bg-emerald-50 border-emerald-200' :
                                    brandColor === 'orange' ? 'bg-orange-50 border-orange-200' :
                                        'bg-blue-50 border-blue-200'
                                }`}>
                                <img
                                    src={provider.logo_url}
                                    alt={provider.name}
                                    className="w-12 h-12 object-contain"
                                />
                            </div>
                        ) : (
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-white ${brandColor === 'emerald' ? 'bg-emerald-500' :
                                    brandColor === 'orange' ? 'bg-orange-500' :
                                        'bg-blue-500'
                                }`}>
                                {type === 'company' ? <Building2 className="w-7 h-7" /> : <Truck className="w-7 h-7" />}
                            </div>
                        )}

                        {/* Note Info */}
                        <div className="flex-1 min-w-0">
                            <h3 className="text-xl font-black text-brand-navy tracking-tight truncate">{note.reference}</h3>
                            <div className="flex items-center gap-2 text-muted-foreground mt-1">
                                <Calendar className="w-3.5 h-3.5" />
                                <span className="text-xs font-semibold">
                                    {note.created_at ? format(new Date(note.created_at), 'dd MMM yyyy, HH:mm') : 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Provider and Parcels Info */}
                <div className="grid grid-cols-2 gap-6">
                    {/* Provider */}
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${brandColor === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                                brandColor === 'orange' ? 'bg-orange-50 text-orange-600' :
                                    'bg-blue-50 text-blue-600'
                            }`}>
                            {type === 'company' ? <Building2 className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
                        </div>
                        <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">
                                {type === 'company' ? 'Provider' : 'Courier'}
                            </span>
                            <span className="text-sm font-bold text-brand-navy truncate mt-1">
                                {provider?.business_name || provider?.name || 'N/A'}
                            </span>
                        </div>
                    </div>

                    {/* Parcel Count */}
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${brandColor === 'emerald' ? 'bg-emerald-50 text-emerald-600' :
                                brandColor === 'orange' ? 'bg-orange-50 text-orange-600' :
                                    'bg-blue-50 text-blue-600'
                            }`}>
                            <Package className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest leading-none">Parcels</span>
                            <span className="text-sm font-bold text-brand-navy mt-1">{note.parcel_count || 0} units</span>
                        </div>
                    </div>
                </div>

                <Separator className="bg-brand-navy/[0.05]" />

                {/* Actions */}
                <div className="flex items-center justify-between">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setSelectedNote(note);
                            setIsViewModalOpen(true);
                        }}
                        className={`font-bold text-xs gap-2 rounded-xl h-11 px-5 ${brandColor === 'emerald' ? 'text-emerald-600 hover:bg-emerald-50' :
                                brandColor === 'orange' ? 'text-orange-600 hover:bg-orange-50' :
                                    'text-blue-600 hover:bg-blue-50'
                            }`}
                    >
                        <Eye className="w-4 h-4" /> Preview
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            setSelectedNote(note);
                            setIsDeleteModalOpen(true);
                        }}
                        className="w-11 h-11 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};
