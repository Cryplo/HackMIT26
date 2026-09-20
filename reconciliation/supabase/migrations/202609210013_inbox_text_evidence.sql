-- Match the validated inbox formats; preserve existing claims and private originals.
begin;
alter table public.supporting_documents drop constraint supporting_documents_file_type_check;
alter table public.supporting_documents add constraint supporting_documents_file_type_check
  check (file_type in ('application/pdf', 'image/png', 'image/jpeg', 'text/csv', 'text/plain', 'message/rfc822'));
-- receipts.file_type is unconstrained; its storage bucket also needs the text types.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'text/csv', 'text/plain', 'message/rfc822']
where id = 'receipts';
commit;
