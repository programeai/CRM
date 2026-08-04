import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ConsentimentoDoContatoDialog } from '@/features/consentimento/ConsentimentoDoContatoDialog';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, Pencil, ShieldCheck, Star, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatPhone, maskPhone, onlyDigits } from '@/lib/format';
import {
  useContacts,
  useCreateContact,
  useUpdateContact,
  useArchiveContact,
} from '../api/hooks';
import type { Client, Contact } from '../api/types';

const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  role: z.string().optional(),
  email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
  phone: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = { name: '', role: '', email: '', phone: '' };

function blank(value?: string): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export default function ContatosTab() {
  const client = useOutletContext<Client>();
  const clientId = client.id;
  const { data: contacts, isLoading } = useContacts(clientId);
  const createContact = useCreateContact(clientId);
  const updateContact = useUpdateContact(clientId);
  const archiveContact = useArchiveContact(clientId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | undefined>();
  const [toArchive, setToArchive] = useState<Contact | undefined>();
  /** O contato cujo livro-razão de consentimento está aberto. */
  const [verConsentimento, setVerConsentimento] = useState<Contact | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  const openCreate = () => {
    setEditing(undefined);
    reset(EMPTY);
    setDialogOpen(true);
  };
  const openEdit = (contact: Contact) => {
    setEditing(contact);
    reset({
      name: contact.name,
      role: contact.role ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
    });
    setDialogOpen(true);
  };

  const onSubmit = async (v: Values) => {
    const body = {
      name: v.name.trim(),
      role: blank(v.role),
      email: blank(v.email),
      phone: blank(v.phone),
    };
    try {
      if (editing) {
        await updateContact.mutateAsync({ id: editing.id, body });
        toast.success('Contato atualizado.');
      } else {
        await createContact.mutateAsync(body);
        toast.success('Contato adicionado.');
      }
      setDialogOpen(false);
    } catch {
      toast.error('Falha ao salvar o contato.');
    }
  };

  const makePrimary = async (contact: Contact) => {
    try {
      await updateContact.mutateAsync({
        id: contact.id,
        body: { isPrimary: true },
      });
      toast.success('Contato principal atualizado.');
    } catch {
      toast.error('Falha ao definir o contato principal.');
    }
  };

  const confirmArchive = async () => {
    if (!toArchive) return;
    try {
      await archiveContact.mutateAsync(toArchive.id);
      toast.success('Contato arquivado.');
    } catch {
      toast.error('Falha ao arquivar o contato.');
    } finally {
      setToArchive(undefined);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Contatos</h2>
        <Button size="sm" onClick={openCreate}>
          <UserPlus data-icon="inline-start" />
          Novo contato
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : contacts && contacts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{contact.name}</span>
                  {contact.isPrimary && (
                    <Badge variant="secondary">Principal</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {[contact.role, contact.email, formatPhone(contact.phone)]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!contact.isPrimary && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Tornar principal"
                    onClick={() => void makePrimary(contact)}
                  >
                    <Star />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Consentimento de ${contact.name}`}
                  title="Consentimento"
                  onClick={() => setVerConsentimento(contact)}
                >
                  <ShieldCheck />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Editar contato"
                  onClick={() => openEdit(contact)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Arquivar contato"
                  onClick={() => setToArchive(contact)}
                >
                  <Archive />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserPlus />
            </EmptyMedia>
            <EmptyTitle>Nenhum contato</EmptyTitle>
            <EmptyDescription>
              Adicione o primeiro contato deste cliente.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Editar contato' : 'Novo contato'}
            </DialogTitle>
            <DialogDescription>Dados de contato da pessoa.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form onSubmit={handleSubmit(onSubmit)} id="contact-form">
              <FieldGroup>
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="contact-name" required>Nome</FieldLabel>
                  <Input
                    id="contact-name"
                    placeholder="Nome do contato"
                    aria-invalid={!!errors.name}
                    {...register('name')}
                  />
                  {errors.name && (
                    <FieldError>{errors.name.message}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-role">Cargo</FieldLabel>
                  <Input id="contact-role" placeholder="Ex.: Gerente de marketing" {...register('role')} />
                </Field>
                <Field data-invalid={!!errors.email}>
                  <FieldLabel htmlFor="contact-email">E-mail</FieldLabel>
                  <Input
                    id="contact-email"
                    type="email"
                    placeholder="contato@empresa.com.br"
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                  {errors.email && (
                    <FieldError>{errors.email.message}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="contact-phone">Telefone</FieldLabel>
                  <Controller
                    control={control}
                    name="phone"
                    render={({ field }) => (
                      <Input
                        id="contact-phone"
                        inputMode="numeric"
                        placeholder="(00) 00000-0000"
                        value={maskPhone(field.value ?? '')}
                        onChange={(e) =>
                          field.onChange(onlyDigits(e.target.value))
                        }
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </Field>
              </FieldGroup>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="contact-form" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {editing ? 'Salvar' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toArchive}
        onOpenChange={(open) => !open && setToArchive(undefined)}
        title="Arquivar contato"
        description={`Tem certeza que deseja arquivar “${toArchive?.name}”? Ele sai da lista e vai para a lixeira, de onde pode ser restaurado.`}
        confirmLabel="Arquivar"
        pendingLabel="Arquivando…"
        destructive
        pending={archiveContact.isPending}
        onConfirm={() => void confirmArchive()}
      />

      <ConsentimentoDoContatoDialog
        contato={verConsentimento}
        onFechar={() => setVerConsentimento(null)}
      />
    </div>
  );
}
