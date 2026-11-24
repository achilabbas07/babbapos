import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";

// Logo brand bawaan aplikasi (Warkop Babba). Dipakai bila tidak ada URL logo
// kustom dari Profil Usaha, atau bila gambar kustom gagal dimuat.
export const DEFAULT_LOGO_URL = "/icon-1024.png";

export const BrandLogo = ({ url, className = "h-9 w-9", iconClass = "h-5 w-5", testid }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  const src = url || DEFAULT_LOGO_URL;
  if (src && !failed) {
    return <img data-testid={testid} src={src} alt="Logo usaha" onError={() => setFailed(true)} className={`${className} shrink-0 rounded-xl bg-card object-contain`} />;
  }
  return (
    <span data-testid={testid} className={`${className} grid shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground`}>
      <Coffee className={iconClass} />
    </span>
  );
};
