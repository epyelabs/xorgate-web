import { Link, useLocation } from "@tanstack/react-router"
import { useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { ChevronRightIcon } from "lucide-react"

export function NavMain({
  label,
  items,
  empty,
}: {
  label: string
  items: {
    title: string
    url: string
    icon?: React.ReactNode
    isActive?: boolean
    items?: {
      title: string
      url: string
    }[]
  }[]
  // Stands in for the menu when the group has no reachable targets — a
  // workspace-scoped group inside an organization with no workspace. The group
  // keeps its label so the section does not silently vanish from the sidebar.
  empty?: React.ReactNode
}) {
  const { pathname } = useLocation()

  if (items.length === 0 && empty) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        {empty}
      </SidebarGroup>
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          if (!item.items?.length) {
            const isActive =
              pathname === item.url || pathname.startsWith(item.url + "/")
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.title}
                >
                  <Link to={item.url}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          }
          return (
            <NestedItem key={item.title} item={item} pathname={pathname} />
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

// A group with children (Models: Datasets, Training, Registry). Opens by
// itself when the current page is under one of its children, so a deep link
// or a reload never lands on a collapsed group hiding the active entry.
function NestedItem({
  item,
  pathname,
}: {
  item: {
    title: string
    url: string
    icon?: React.ReactNode
    isActive?: boolean
    items?: { title: string; url: string }[]
  }
  pathname: string
}) {
  const childActive = (url: string) =>
    pathname === url || pathname.startsWith(url + "/")
  const anyActive = item.items?.some((s) => childActive(s.url)) ?? false
  const [open, setOpen] = useState(item.isActive || anyActive)
  const isOpen = open || anyActive
  return (
            <Collapsible
              asChild
              open={isOpen}
              onOpenChange={setOpen}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title} isActive={anyActive}>
                    {item.icon}
                    <span>{item.title}</span>
                    <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={childActive(subItem.url)}
                        >
                          <Link to={subItem.url}>
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
  )
}
