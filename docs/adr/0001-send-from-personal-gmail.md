# Send from the Admin's personal Gmail

Applications are sent through the Gmail API from the Admin's own account, not an email service such as Resend. Replies land in the Admin's inbox and the mail reads as personal rather than bulk, and a transactional service would need a custom domain and be more likely to be marked as spam. We accept Google OAuth setup and Gmail's sending limits.

Replies are found the same way: the agent records each sent email's Gmail thread and reads those threads with the `gmail.readonly` scope. That scope lets it read the whole mailbox, which we accept over asking the Admin to forward replies or label them by hand. Connections made before this scope was added must be reconnected once.
