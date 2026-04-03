import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, RefreshCw, Trash2, Smartphone } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function WhatsAppManager() {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchInstances();
    
    // Subscribe to realtime updates for QR or status changes
    const channel = supabase.channel('whatsapp_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_instances' }, (payload) => {
        fetchInstances();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchInstances = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    
    const businessId = localStorage.getItem('activeBusinessId');
    if (!businessId) return;

    const { data } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('business_id', businessId);
      
    if (data) setInstances(data);
    setLoading(false);
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) return;
    try {
      setLoading(true);
      const createRes = await whatsappService.createInstance(newInstanceName);
      
      const { data: userData } = await supabase.auth.getUser();
      const businessId = localStorage.getItem('activeBusinessId');
      
      await supabase.from('whatsapp_instances').insert({
        business_id: businessId,
        instance_name: newInstanceName,
        status: 'connecting'
      });
      
      console.log('Evolution Immediate Create Res:', createRes);
      
      if (createRes?.qrcode?.base64) {
        setQrCode(createRes.qrcode.base64);
        toast({ title: "Instance Created", description: "QR Code generated instantly." });
      } else {
         toast({ title: "Instance Created", description: "Fetching QR code in background..." });
         // Fallback if not returned instantly
         setTimeout(async () => {
           try {
             // Let's try connectionState as well just in case
             const qrRes = await whatsappService.getQrCode(newInstanceName);
             console.log('Evolution delayed QR res:', qrRes);
             if (qrRes?.qrcode?.base64) setQrCode(qrRes.qrcode.base64);
             else if (qrRes?.base64) setQrCode(qrRes.base64);
           } catch(e) {}
         }, 5000);
      }
      
      setNewInstanceName('');
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      fetchInstances();
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Smartphone className="w-6 h-6" /> WhatsApp Instances
      </h1>
      
      <div className="flex gap-4 mb-8 bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <Input 
          placeholder="New Instance Name (e.g. Sales1)" 
          value={newInstanceName}
          onChange={(e) => setNewInstanceName(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={handleCreateInstance} disabled={loading || !newInstanceName}>
          <Plus className="w-4 h-4 mr-2" /> Add Number
        </Button>
      </div>

      {qrCode && (
        <div className="mb-8 p-4 bg-white border border-gray-200 rounded-lg shadow-sm w-max">
          <h3 className="font-semibold mb-4">Scan QR to connect</h3>
          <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64 border" />
          <Button variant="outline" className="mt-4" onClick={() => setQrCode(null)}>Close</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading && <p>Loading instances...</p>}
        {!loading && instances.map(inst => (
          <div key={inst.id} className="p-5 bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col gap-3">
            <h3 className="text-lg font-bold">{inst.instance_name}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className={`w-3 h-3 rounded-full ${inst.status === 'open' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
              {inst.status.toUpperCase()}
            </div>
            {inst.phone_number && <p className="text-sm font-medium">{inst.phone_number}</p>}
            
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
              {inst.status !== 'open' && (
                <Button variant="outline" size="sm" onClick={async () => {
                  try {
                    const qr = await whatsappService.getQrCode(inst.instance_name);
                    console.log('Evolution QR response:', qr);
                    if (qr?.base64) {
                      setQrCode(qr.base64);
                    } else if (qr?.qrcode?.base64) {
                      setQrCode(qr.qrcode.base64);
                    } else if (qr?.error) {
                      toast({ title: "QR Error", description: qr.error, variant: "destructive" });
                    } else {
                      toast({ title: "QR Status", description: "QR string not found in response. " + JSON.stringify(qr).slice(0, 100) });
                    }
                  } catch (err: any) {
                    toast({ title: "Error", description: err.message, variant: "destructive" });
                  }
                }}>
                  <RefreshCw className="w-4 h-4 mr-2" /> QR
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={async () => {
                await whatsappService.deleteInstance(inst.instance_name);
                await supabase.from('whatsapp_instances').delete().eq('id', inst.id);
                fetchInstances();
              }}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
