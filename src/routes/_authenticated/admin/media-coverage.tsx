import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, Calendar, Play, Camera, ThumbsUp, Briefcase } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/media-coverage")({
  component: MediaCoveragePage,
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Platform = "youtube" | "instagram" | "facebook" | "linkedin";

interface MediaPost {
  id: string;
  platform: Platform;
  title: string;
  date: string;       // ISO date
  thumbnailUrl: string;
  postUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Platform meta (icons, colours, labels)                             */
/* ------------------------------------------------------------------ */

const PLATFORM_META: Record<
  Platform,
  { label: string; icon: typeof Play; color: string; bgGradient: string; badgeBg: string }
> = {
  youtube: {
    label: "YouTube",
    icon: Play,
    color: "text-red-500",
    bgGradient: "from-red-500/10 to-red-600/5",
    badgeBg: "bg-red-500",
  },
  instagram: {
    label: "Instagram",
    icon: Camera,
    color: "text-pink-500",
    bgGradient: "from-pink-500/10 to-purple-600/5",
    badgeBg: "bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600",
  },
  facebook: {
    label: "Facebook",
    icon: ThumbsUp,
    color: "text-blue-600",
    bgGradient: "from-blue-500/10 to-blue-600/5",
    badgeBg: "bg-blue-600",
  },
  linkedin: {
    label: "LinkedIn",
    icon: Briefcase,
    color: "text-sky-600",
    bgGradient: "from-sky-500/10 to-sky-600/5",
    badgeBg: "bg-sky-700",
  },
};

/* ------------------------------------------------------------------ */
/*  Sample data – replace with Supabase query later                    */
/* ------------------------------------------------------------------ */

const SAMPLE_POSTS: MediaPost[] = [
  // YouTube
  {
    id: "yt-1",
    platform: "youtube",
    title: "Senseflow Smart Water Meter – Product Demo",
    date: "2026-08-28",
    thumbnailUrl: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=640&q=80",
    postUrl: "https://youtube.com",
  },
  {
    id: "yt-2",
    platform: "youtube",
    title: "How IoT is Transforming Water Management",
    date: "2026-08-15",
    thumbnailUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=640&q=80",
    postUrl: "https://youtube.com",
  },
  {
    id: "yt-3",
    platform: "youtube",
    title: "Customer Success Story – Society Water Savings",
    date: "2026-07-20",
    thumbnailUrl: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=640&q=80",
    postUrl: "https://youtube.com",
  },
  {
    id: "yt-4",
    platform: "youtube",
    title: "Installation Guide – Senseflow Meter Setup",
    date: "2026-06-10",
    thumbnailUrl: "https://images.unsplash.com/photo-1531482615713-2afd69097998?w=640&q=80",
    postUrl: "https://youtube.com",
  },

  // Instagram
  {
    id: "ig-1",
    platform: "instagram",
    title: "Every drop counts 💧 Our smart meters in action!",
    date: "2026-09-01",
    thumbnailUrl: "https://images.unsplash.com/photo-1527689368864-3a821dbccc34?w=640&q=80",
    postUrl: "https://instagram.com",
  },
  {
    id: "ig-2",
    platform: "instagram",
    title: "Behind the scenes at Senseflow HQ 🏢",
    date: "2026-08-22",
    thumbnailUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=640&q=80",
    postUrl: "https://instagram.com",
  },
  {
    id: "ig-3",
    platform: "instagram",
    title: "Happy World Water Day! 🌊 #SaveWater",
    date: "2026-08-05",
    thumbnailUrl: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=640&q=80",
    postUrl: "https://instagram.com",
  },

  // Facebook
  {
    id: "fb-1",
    platform: "facebook",
    title: "Senseflow participates in Smart City Expo 2026",
    date: "2026-08-30",
    thumbnailUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=640&q=80",
    postUrl: "https://facebook.com",
  },
  {
    id: "fb-2",
    platform: "facebook",
    title: "New partnership announcement – Water Conservation Initiative",
    date: "2026-08-10",
    thumbnailUrl: "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=640&q=80",
    postUrl: "https://facebook.com",
  },
  {
    id: "fb-3",
    platform: "facebook",
    title: "Community outreach – Teaching water conservation to kids",
    date: "2026-07-28",
    thumbnailUrl: "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=640&q=80",
    postUrl: "https://facebook.com",
  },

  // LinkedIn
  {
    id: "li-1",
    platform: "linkedin",
    title: "Senseflow raises Series A funding for smart water infrastructure",
    date: "2026-09-02",
    thumbnailUrl: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=640&q=80",
    postUrl: "https://linkedin.com",
  },
  {
    id: "li-2",
    platform: "linkedin",
    title: "Our CTO speaks at IoT World Summit 2026",
    date: "2026-08-18",
    thumbnailUrl: "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=640&q=80",
    postUrl: "https://linkedin.com",
  },
  {
    id: "li-3",
    platform: "linkedin",
    title: "We're hiring! Join the Senseflow engineering team",
    date: "2026-07-05",
    thumbnailUrl: "https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=640&q=80",
    postUrl: "https://linkedin.com",
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PostCard({ post }: { post: MediaPost }) {
  const meta = PLATFORM_META[post.platform];
  const Icon = meta.icon;

  return (
    <a
      href={post.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/15 bg-card/60 shadow-md backdrop-blur-lg transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      id={`media-post-${post.id}`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden">
        <img
          src={post.thumbnailUrl}
          alt={post.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-60 transition-opacity group-hover:opacity-80" />

        {/* Platform badge */}
        <div
          className={cn(
            "absolute top-3 left-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg",
            meta.badgeBg,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </div>

        {/* External link icon on hover */}
        <div className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <ExternalLink className="h-4 w-4" />
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
          {post.title}
        </h3>
        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          {formatDate(post.date)}
        </div>
      </div>
    </a>
  );
}

function EmptyState({ platform }: { platform: Platform }) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className={cn("rounded-2xl bg-gradient-to-br p-5", meta.bgGradient)}>
        <Icon className={cn("h-10 w-10", meta.color)} />
      </div>
      <div>
        <p className="text-lg font-semibold text-foreground">No {meta.label} posts yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Posts from your {meta.label} account will appear here.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

function MediaCoveragePage() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const [activeTab, setActiveTab] = useState<Platform>("youtube");

  const platforms: Platform[] = ["youtube", "instagram", "facebook", "linkedin"];

  const postsByPlatform = (p: Platform) =>
    SAMPLE_POSTS
      .filter((post) => post.platform === p)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Media Coverage"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <p className="mb-6 text-sm text-muted-foreground">
        Browse all social media posts across platforms. Click any post to view it on the original platform.
      </p>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as Platform)}
        className="w-full"
      >
        <TabsList className="mb-6 flex h-auto w-full flex-wrap gap-1 bg-muted/50 p-1.5 sm:inline-flex sm:w-auto">
          {platforms.map((p) => {
            const meta = PLATFORM_META[p];
            const Icon = meta.icon;
            const count = postsByPlatform(p).length;
            return (
              <TabsTrigger
                key={p}
                value={p}
                className="flex items-center gap-2 px-4 py-2.5 data-[state=active]:shadow-md"
                id={`tab-${p}`}
              >
                <Icon className={cn("h-4 w-4", activeTab === p ? meta.color : "")} />
                <span className="hidden sm:inline">{meta.label}</span>
                {count > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-0.5 h-5 min-w-5 px-1.5 text-[10px] font-bold"
                  >
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {platforms.map((p) => {
          const posts = postsByPlatform(p);
          return (
            <TabsContent key={p} value={p}>
              {posts.length === 0 ? (
                <Card>
                  <CardContent className="p-0">
                    <EmptyState platform={p} />
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {posts.map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </DashboardLayout>
  );
}
