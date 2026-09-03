
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Droplets, Menu, X, UserCog, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveRole, type AppRole } from "@/hooks/use-session";
import { GradientWave } from "@/components/ui/gradient-wave";

export interface NavItem {
  label: string;
  href: string;
}

interface Props {
  children: ReactNode;
  navItems: NavItem[];
  title: string;
  userName?: string | null;
  userPhone?: string | null;
}

export function DashboardLayout({ children, navItems, title, userName, userPhone }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Auth is off — expose all roles in the switcher so anyone can hop between dashboards.
  const allRoles: AppRole[] = ["admin", "secretary", "consumer"];
  const { activeRole, setActiveRole } = useActiveRole(allRoles);

  const initials = (userName || userPhone || "U")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const goHome = async () => {
    await qc.cancelQueries();
    qc.clear();
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("sf_active_role");
    }
    navigate({ to: "/", replace: true });
  };

  const switchRole = (r: AppRole) => {
    if (r === activeRole) return;
    setActiveRole(r);
    qc.clear();
    if (r === "admin") navigate({ to: "/admin", replace: true });
    else if (r === "secretary") navigate({ to: "/secretary", replace: true });
    else navigate({ to: "/consumer", replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <GradientWave className="opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background" />
      </div>
      <header className="sticky top-0 z-40 border-b border-white/20 bg-background/60 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="flex items-center gap-2">
              <Droplets className="h-6 w-6 text-primary" />
              <span className="font-bold">SensorFlow</span>
            </Link>
            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    pathname === item.href
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{initials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="font-medium">{userName || "Signed in"}</div>
                  {userPhone && (
                    <div className="text-xs text-muted-foreground">{userPhone}</div>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {activeRole && (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      <UserCog className="mr-2 inline h-3.5 w-3.5" />
                      Switch role
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={activeRole}
                      onValueChange={(v) => switchRole(v as AppRole)}
                    >
                      {allRoles.map((r) => (
                        <DropdownMenuRadioItem key={r} value={r} className="capitalize">
                          {r}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={goHome}>
                  <Home className="mr-2 h-4 w-4" />
                  Back to home
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="border-t bg-background px-4 py-3 md:hidden">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm font-medium",
                  pathname === item.href
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="container mx-auto px-4 py-6">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}