"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BotIcon,
  ClockIcon,
  FolderGit2Icon,
  KanbanIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

const nav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/projects", label: "Projects", icon: FolderGit2Icon },
  { href: "/terminals", label: "Terminals", icon: BotIcon },
  { href: "/kanban", label: "Kanban", icon: KanbanIcon },
  { href: "/scheduler", label: "Scheduler", icon: ClockIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function AppNavMenu() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  function handleNavigate() {
    if (isMobile) {
      setOpenMobile(false);
    }
  }

  return (
    <SidebarMenu>
      {nav.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={active}
              tooltip={item.label}
              onClick={handleNavigate}
              render={<Link href={item.href} />}
            >
              <Icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function Sidebar() {
  const router = useRouter();
  const logout = useAuth((s) => s.logout);
  const { isMobile, setOpenMobile } = useSidebar();

  function handleDisconnect() {
    if (isMobile) {
      setOpenMobile(false);
    }
    logout();
    router.push("/connect");
  }

  return (
    <SidebarRoot collapsible="icon" className="md:[--sidebar-width:14rem]">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Maestro"
              render={<Link href="/" />}
              className="group-data-[collapsible=icon]:justify-center"
            >
              <span className="ascii-logo truncate text-sm group-data-[collapsible=icon]:hidden">
                Maestro
              </span>
              <span className="ascii-logo ascii-logo--single hidden text-sm group-data-[collapsible=icon]:inline">
                S
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <AppNavMenu />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="mx-0" />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Disconnect" onClick={handleDisconnect}>
              <LogOutIcon />
              <span>Disconnect</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </SidebarRoot>
  );
}
