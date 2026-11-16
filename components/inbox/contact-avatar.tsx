"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarColor, initialsOf } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

/** A contact's picture when we have one, otherwise a coloured circle with their initials. */
export function ContactAvatar({
  name,
  handle,
  imageUrl,
  size = "lg",
  className,
}: {
  name: string;
  handle: string;
  imageUrl?: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
      <AvatarFallback className={cn("text-xs font-semibold", avatarColor(handle || name).chip)}>{initialsOf(name, handle)}</AvatarFallback>
    </Avatar>
  );
}
