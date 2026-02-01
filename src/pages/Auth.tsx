import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ChevronRight } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const loginSchema = z.object({
    identifier: z.string().min(3, "Username or Email is required"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const Auth = () => {
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const navigate = useNavigate();

    const { register, handleSubmit, formState: { errors } } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
    });

    const handleLogin = async (values: LoginFormValues) => {
        setLoading(true);
        try {
            let email = values.identifier;

            // Polymorphic login: If identifier doesn't look like an email, try to find the email by username
            if (!values.identifier.includes('@')) {
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('email')
                    .eq('username', values.identifier)
                    .single();

                if (userError || !user) {
                    throw new Error('User not found with this username');
                }
                email = user.email;
            }

            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password: values.password,
            });

            if (error) throw error;

            toast({
                title: "Welcome back!",
                description: "Successfully signed in to DigiCom.",
            });
            navigate('/');
        } catch (error: any) {
            toast({
                title: "Sign in failed",
                description: error.message,
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-cover bg-center bg-no-repeat font-['Poppins',_sans-serif] relative overflow-hidden"
            style={{ backgroundImage: "url('https://assets.website-files.com/63a1c80ea425df2a356d4b4a/63a1c9981bffad3632a844a8_bg.jpg')" }}>

            {/* Main Container Wrapper */}
            <div className="w-full max-w-[1600px] min-h-screen flex flex-col lg:flex-row justify-between items-center px-10 lg:pl-[150px] lg:pr-[100px] animate-in fade-in duration-1000 py-20 relative z-10">

                {/* Left Column: Heading and Brand Info - Pushed Left */}
                <div className="flex flex-col justify-end pb-[60px] w-full lg:w-[450px] mb-12 lg:mb-0 text-left self-end lg:self-auto">
                    <h1 className="text-[45px] lg:text-[55px] font-medium leading-[1.1] text-white drop-shadow-2xl">
                        It’s time to boost your <br /><span className="italic font-light opacity-90">creativity</span>
                    </h1>

                    <div className="mt-[45px] p-[25px_30px_25px_20px] bg-white/10 backdrop-blur-md border border-white/20 rounded-[24px] w-fit text-white/80 shadow-xl group cursor-default">
                        <p className="text-[14px] mb-[12px] font-bold tracking-[0.2em] uppercase opacity-60">DIGICOM NETWORK</p>
                        <div className="flex items-center gap-4">
                            <span className="text-[25px] font-medium text-white">Management</span>
                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#2d6d6c] shadow-lg group-hover:scale-110 transition-transform">
                                <ChevronRight className="w-6 h-6" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Sign In Form - Shifted Right */}
                <div className="flex flex-col w-full lg:w-[570px] min-h-[750px] px-10 lg:px-[80px] py-[70px] bg-[#2d6d6c]/25 backdrop-blur-xl border border-white/10 rounded-[40px] text-white justify-between animate-in slide-in-from-right-20 duration-1000 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] relative overflow-hidden">

                    {/* Brand Identity */}
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center shadow-xl transform -rotate-3 overflow-hidden p-2">
                            <img
                                src="/Logo/DigiCom Icon Transparent.png"
                                alt="DigiCom"
                                className="w-full h-full object-contain"
                            />
                        </div>
                        <span className="text-3xl font-black text-white tracking-tighter">DigiCom.</span>
                    </div>

                    {/* Form Section */}
                    <div className="block w-full mt-12 mb-8">
                        <div className="form-block w-full">
                            <h2 className="text-[35px] font-medium leading-tight text-white mb-2">Sign in</h2>
                            <p className="text-white/50 text-sm mb-8">Secure access to administrative tools</p>

                            <form onSubmit={handleSubmit(handleLogin)} className="flex flex-col space-y-5">
                                {/* Identifier */}
                                <div className="flex flex-col">
                                    <label className="ml-4 mb-2 text-[13px] font-bold uppercase tracking-widest text-white/60">Username or Email</label>
                                    <input
                                        type="text"
                                        placeholder="Jane Doe / email@digicom.com"
                                        {...register('identifier')}
                                        className="w-full h-14 px-6 py-4 border border-white/10 rounded-[30px] bg-white/10 text-white text-[15px] font-medium placeholder:text-white/20 focus:outline-none focus:border-white/40 focus:bg-white/20 transition-all backdrop-blur-sm shadow-inner"
                                    />
                                    {errors.identifier && <span className="text-red-400 text-[11px] mt-1.5 ml-4 font-bold tracking-tight uppercase">{errors.identifier.message}</span>}
                                </div>

                                {/* Password */}
                                <div className="flex flex-col">
                                    <label className="ml-4 mb-2 text-[13px] font-bold uppercase tracking-widest text-white/60">Password</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        {...register('password')}
                                        className="w-full h-14 px-6 py-4 border border-white/10 rounded-[30px] bg-white/10 text-white text-[15px] font-medium placeholder:text-white/20 focus:outline-none focus:border-white/40 focus:bg-white/20 transition-all backdrop-blur-sm shadow-inner"
                                    />
                                    {errors.password && <span className="text-red-400 text-[11px] mt-1.5 ml-4 font-bold tracking-tight uppercase">{errors.password.message}</span>}
                                </div>

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full h-[60px] mt-4 bg-white text-[#2d6d6c] text-[18px] font-bold rounded-[40px] hover:bg-white/90 active:scale-[0.98] transition-all duration-300 shadow-2xl flex items-center justify-center"
                                >
                                    {loading ? (
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    ) : (
                                        "Enter Dashboard"
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>

                    <div className="text-center opacity-40 text-[12px] tracking-[0.2em] uppercase font-bold">
                        Encrypted Session
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Auth;
