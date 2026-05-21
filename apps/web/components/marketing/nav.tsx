import Link from "next/link";
import { Container, Button } from "@/components/ui";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/80 border-b border-slate-200/50">
      <Container size="xl">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-sm">
              A
            </div>
            <span className="font-bold text-slate-900">Aibenchef</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-slate-600">
            <Link href="/#planes" className="hover:text-slate-900 transition-colors">
              Planes
            </Link>
            <Link href="/#faq" className="hover:text-slate-900 transition-colors">
              FAQ
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center text-sm text-slate-700 hover:text-slate-900 font-medium px-3 py-2"
            >
              Entrar
            </Link>
            <Link href="/waitlist">
              <Button size="sm">Waitlist</Button>
            </Link>
          </div>
        </div>
      </Container>
    </header>
  );
}
