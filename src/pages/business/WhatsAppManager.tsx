import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { whatsappService } from '@/lib/api/whatsappService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, RefreshCw, Trash2, Smartphone, Phone, Loader2, QrCode, CheckCircle2, MessageSquare } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export default function WhatsAppManager() {
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchInstances();
    
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
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
      
    if (data) setInstances(data);
    setLoading(false);
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName.trim()) return;
    try {
      setActionLoading('create');
      const createRes = await whatsappService.createInstance(newInstanceName);
      
      const businessId = localStorage.getItem('activeBusinessId');
      
      await supabase.from('whatsapp_instances').insert({
        business_id: businessId,
        instance_name: newInstanceName,
        status: 'connecting'
      });
      
      if (createRes?.qrcode?.base64) {
        setQrCode(createRes.qrcode.base64);
        toast({ title: "Instance Created", description: "Ready to pair device." });
      } else {
         toast({ title: "Instance Created", description: "Fetching QR code..." });
         setTimeout(async () => {
           try {
             const qrRes = await whatsappService.getQrCode(newInstanceName);
             if (qrRes?.qrcode?.base64) setQrCode(qrRes.qrcode.base64);
             else if (qrRes?.base64) setQrCode(qrRes.base64);
           } catch(e) {}
         }, 5000);
      }
      
      setNewInstanceName('');
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
      fetchInstances();
    }
  };

  const fetchAndShowQR = async (instanceName: string) => {
    try {
      setActionLoading(`qr-${instanceName}`);
      const qr = await whatsappService.getQrCode(instanceName);
      if (qr?.base64) {
        setQrCode(qr.base64);
      } else if (qr?.qrcode?.base64) {
        setQrCode(qr.qrcode.base64);
      } else if (qr?.error) {
        toast({ title: "Session Error", description: qr.error, variant: "destructive" });
      } else {
        toast({ title: "Status", description: "Device is already connected or QR unavailable.", variant: "default" });
      }
    } catch (err: any) {
      toast({ title: "Connection Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteInstance = async (id: string, instanceName: string) => {
    try {
      setActionLoading(`delete-${instanceName}`);
      await whatsappService.deleteInstance(instanceName);
      await supabase.from('whatsapp_instances').delete().eq('id', id);
      toast({ title: "Deleted", description: "Instance removed successfully." });
      fetchInstances();
    } catch (err: any) {
      toast({ title: "Delete Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-8 pb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Standard Admin Header Section */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Integrations</p>
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">
              WhatsApp Devices
            </h1>
            <p className="text-gray-500 font-light text-sm max-w-xl">
              Connect and manage physical devices to automate delivery notifications and customer messaging in real-time.
            </p>
          </div>
          <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
            <Smartphone className="w-7 h-7 text-primary/80" />
          </div>
        </div>
      </div>

      {/* Instance Creation Card */}
      <Card className="border-0 shadow-sm rounded-3xl bg-white bg-gradient-to-br from-white to-gray-50/50">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1">
              <h3 className="text-lg font-medium text-gray-900">Connect New Device</h3>
              <p className="text-sm font-light text-gray-500">Enter a unique label for your new connection to generate a pairing QR code.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              <Input 
                placeholder="e.g. Sales-Number-1" 
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value.replace(/\s+/g, '-'))}
                className="w-full sm:w-[250px] rounded-2xl bg-gray-50/50 border-gray-100 focus-visible:ring-primary/20"
                disabled={actionLoading === 'create'}
              />
              <Button 
                onClick={handleCreateInstance} 
                disabled={!newInstanceName || actionLoading === 'create'}
                className="rounded-2xl shadow-sm px-6 h-10"
              >
                {actionLoading === 'create' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Generate QR
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid of Instances */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse border-0 shadow-sm rounded-3xl bg-white">
              <CardContent className="h-[200px]" />
            </Card>
          ))
        ) : instances.length === 0 ? (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-center bg-white rounded-3xl border border-dashed border-gray-200">
            <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-xl font-light text-gray-900">No devices connected</h3>
            <p className="text-gray-500 font-light mt-2 max-w-sm">Generate a QR code above to link your first WhatsApp account to the platform.</p>
          </div>
        ) : (
          instances.map(inst => {
            const isOpen = inst.status === 'open';
            return (
              <Card key={inst.id} className="relative overflow-hidden border-0 shadow-sm rounded-3xl bg-white transition-all hover:shadow-md">
                <div className={cn("absolute top-0 left-0 w-full h-1.5 transition-colors", isOpen ? "bg-emerald-500/80" : "bg-amber-400/80")} />
                
                <CardContent className="p-6">
                  <div className="flex justify-between items-start mb-6 mt-1">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-12 w-12 border border-gray-100 shadow-sm">
                        <AvatarImage src={inst.profile_pic} />
                        <AvatarFallback className="bg-gradient-to-br from-primary/10 to-primary/5 text-primary text-sm font-medium">
                          {inst.instance_name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 truncate max-w-[150px]">{inst.instance_name}</h3>
                        {inst.phone_number ? (
                          <div className="flex items-center text-xs text-gray-500 font-light mt-1 gap-1.5">
                            <Phone className="w-3 h-3 text-gray-400" /> {inst.phone_number}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 font-light mt-1">Unpaired device</div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between py-4 border-t border-gray-50">
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Status</span>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "rounded-full text-[10px] font-bold uppercase border px-3 py-1",
                        isOpen 
                          ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                          : "bg-amber-50 text-amber-800 border-amber-100"
                      )}
                    >
                      {isOpen && <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                      {!isOpen && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                      {isOpen ? 'Connected' : 'Pending'}
                    </Badge>
                  </div>
                </CardContent>

                <div className="px-3 pb-3 flex justify-end gap-2 bg-gray-50/50 pt-3 border-t border-gray-50">
                  {!isOpen && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1 rounded-xl bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium h-9 text-xs"
                      disabled={actionLoading !== null}
                      onClick={() => fetchAndShowQR(inst.instance_name)}
                    >
                      {actionLoading === `qr-${inst.instance_name}` ? (
                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      ) : (
                        <QrCode className="w-3.5 h-3.5 mr-2 text-primary/70" />
                      )}
                      Scan QR
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="flex-1 rounded-xl text-red-600/80 hover:text-red-700 hover:bg-red-50 font-medium h-9 text-xs"
                    disabled={actionLoading !== null}
                    onClick={() => handleDeleteInstance(inst.id, inst.instance_name)}
                  >
                    {actionLoading === `delete-${inst.instance_name}` ? (
                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                    )}
                    Remove
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Polished QR Code Modal */}
      <Dialog open={!!qrCode} onOpenChange={(open) => !open && setQrCode(null)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-white/95 backdrop-blur-md shadow-2xl rounded-3xl border-0">
          <div className="bg-gradient-to-r from-primary/5 to-transparent p-8 text-center border-b border-gray-100">
            <DialogHeader>
              <DialogTitle className="text-2xl font-extralight text-gray-900 text-center tracking-tight">Pair WhatsApp Device</DialogTitle>
              <DialogDescription className="text-center pt-3 font-light text-gray-500">
                Open WhatsApp {"->"} Settings {"->"} Linked Devices {"->"} Link a Device
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="p-10 flex flex-col items-center justify-center bg-gray-50/50 relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white via-transparent to-transparent opacity-60 pointer-events-none" />
            <div className="relative bg-white p-5 rounded-3xl shadow-sm border border-gray-100">
              {qrCode ? (
                <img src={qrCode} alt="WhatsApp QR Code Matrix" className="w-64 h-64 mx-auto rounded-xl" />
              ) : (
                <div className="w-64 h-64 flex flex-col items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary/60 mb-4" />
                  <p className="text-gray-400 font-light text-sm">Generating secure code...</p>
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-8 text-center font-bold">
              E2E Encrypted Session
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
