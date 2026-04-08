import React from 'react';

const CourierDashboard = () => {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl md:text-3xl font-black text-brand-navy tracking-tight">Dashboard</h1>
                <p className="text-sm text-brand-navy/50 font-medium mt-1">Overview of your deliveries</p>
            </div>
            <div className="rounded-3xl bg-brand-navy/[0.04] p-6 md:p-10 border border-brand-navy/5">
                <p className="text-sm font-bold text-brand-navy/40 uppercase tracking-widest">Pending specification</p>
            </div>
        </div>
    );
};

export default CourierDashboard;
