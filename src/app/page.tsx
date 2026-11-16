export const metadata = {
  title: 'Foguito — En construcción',
  description: 'Foguito estará disponible pronto. Estamos trabajando para ti.',
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  return (
    <main className="foguito-maintenance" aria-labelledby="maintenance-title">
      <div className="foguito-lockup">
        <svg className="foguito-flame" viewBox="0 0 70 78" role="img" aria-label="Símbolo de Foguito">
          <defs>
            <linearGradient id="foguito-flame-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF5330" />
              <stop offset="100%" stopColor="#FF2E96" />
            </linearGradient>
          </defs>
          <path d="M35 4 C45 20 58 28 58 48 A23 25 0 1 1 12 48 C12 34 24 30 28 20 C30 30 40 30 35 4Z" fill="url(#foguito-flame-gradient)" />
          <path d="M37 30 C43 40 48 44 48 52 A13 14 0 1 1 22 52 C22 46 28 44 31 37 C33 44 40 43 37 30Z" fill="#FFF6EF" />
        </svg>
        <div className="foguito-wordmark">foguito</div>
        <h1 id="maintenance-title">En construcción</h1>
      </div>
      <style>{`
        html, body { min-height: 100%; background: #000 !important; }
        body { margin: 0; }
        .foguito-maintenance {
          min-height: 100svh; width: 100%; display: flex; align-items: center;
          justify-content: center; overflow: hidden; padding: 32px 20px;
          box-sizing: border-box; background: #000; color: #fff; text-align: center;
        }
        .foguito-lockup { display: flex; flex-direction: column; align-items: center; justify-content: center; transform: translateY(-1.5vh); }
        .foguito-flame { display: block; width: clamp(112px, 17vw, 190px); height: auto; margin-bottom: clamp(26px, 4vw, 42px); overflow: visible; }
        .foguito-wordmark {
          color: #fff; font-family: 'Fredoka', 'Arial Rounded MT Bold', sans-serif;
          font-size: clamp(64px, 11vw, 124px); font-weight: 700; line-height: .95; letter-spacing: .005em;
        }
        .foguito-lockup h1 {
          margin: clamp(26px, 4vw, 38px) 0 0; color: #FFF6EF;
          font-family: 'Fredoka', 'Arial Rounded MT Bold', sans-serif;
          font-size: clamp(17px, 2.2vw, 22px); font-weight: 500; letter-spacing: .035em;
        }
      `}</style>
    </main>
  )
}
