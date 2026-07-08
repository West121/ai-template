import { Fragment } from "react"
import { Link, useLocation } from "react-router-dom"
import { findMenuChain } from "@/config/menu"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function Breadcrumbs() {
  const { pathname } = useLocation()
  const chain = findMenuChain(pathname)
  if (chain.length === 0) return null

  return (
    <Breadcrumb className="hidden md:block">
      <BreadcrumbList>
        {chain.map((item, index) => {
          const last = index === chain.length - 1
          return (
            <Fragment key={item.path}>
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{item.title}</BreadcrumbPage>
                ) : item.children?.length ? (
                  <span className="text-muted-foreground">{item.title}</span>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={item.path}>{item.title}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
