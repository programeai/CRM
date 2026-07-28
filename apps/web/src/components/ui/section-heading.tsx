import type { ReactNode } from "react"

/**
 * Cabeçalho de uma seção dentro de uma página: título, descrição e, à direita
 * e alinhada ao topo, a ação principal (`children`).
 *
 * Existe porque a ação e o texto precisam nascer juntos — quem tem o botão é a
 * tela, não o layout que desenha as abas em volta dela.
 */
export function SectionHeading({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      )}
    </div>
  )
}
