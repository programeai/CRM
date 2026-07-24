import { Badge } from '@/components/ui/badge';
import { tagColors } from '@/lib/tag-color';
import { cn } from '@/lib/utils';

/**
 * Chip de tag com cor de fundo determinística e texto de contraste automático
 * (preto ou branco), decidido por `readableTextColor`. Use sempre este
 * componente para renderizar tags — não monte badges de tag à mão.
 */
export function TagBadge({
  tag,
  className,
  ...rest
}: Omit<React.ComponentProps<typeof Badge>, 'variant' | 'children' | 'style'> & {
  tag: string;
}) {
  return (
    <Badge
      variant="secondary"
      style={{ ...tagColors(tag), borderColor: 'transparent' }}
      className={cn(
        'rounded px-1.5 py-0 text-[0.625rem] font-medium leading-4',
        className,
      )}
      {...rest}
    >
      {tag}
    </Badge>
  );
}
