import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ArrowLeft, Compass, Home } from 'lucide-react';

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <div className="ant-surface min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[560px] rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
        <div className="h-[3px] w-full bg-ant-orange" />
        <div className="p-8 md:p-10 space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
              <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
              Erreur · Route inconnue
            </div>
            <h1 className="font-display text-[72px] md:text-[88px] leading-[0.95] tracking-[-0.04em] text-ant-ink tabular-nums">
              404
            </h1>
            <p className="font-serif italic text-[15px] md:text-[16px] leading-relaxed text-ant-mid max-w-md">
              Cette page s&apos;est volatilisée — ou n&apos;a jamais existé. Le chemin que vous cherchez ne mène nulle part sur iGrowFast.
            </p>
          </div>

          <div className="rounded-xl border border-ant-line bg-ant-light px-4 py-3 flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg border border-ant-line bg-ant-paper text-ant-mid flex items-center justify-center shrink-0">
              <Compass className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                Chemin demandé
              </p>
              <p className="font-display text-[13px] font-semibold text-ant-ink break-all tabular-nums">
                {location.pathname || '/'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-ant-line">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-semibold text-ant-ink cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
              Revenir en arrière
            </button>
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full bg-ant-ink hover:bg-ant-ink/90 text-white text-[12px] font-semibold cursor-pointer transition-colors"
            >
              <Home className="w-3.5 h-3.5" strokeWidth={1.75} />
              Retour au tableau de bord
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
