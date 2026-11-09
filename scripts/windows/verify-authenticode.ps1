param(
  [Parameter(Mandatory = $true)]
  [string] $Path,

  [string] $SubjectPattern
)

$files = Get-ChildItem -Path $Path -Filter "aiTeamOS-*.exe" -File
if ($files.Count -eq 0) {
  throw "No aiTeamOS installer executable was found under $Path."
}

foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -FilePath $file.FullName
  if ($signature.Status -ne "Valid") {
    throw "Authenticode verification failed for $($file.FullName): $($signature.Status) $($signature.StatusMessage)"
  }
  if ($SubjectPattern -and $signature.SignerCertificate.Subject -notlike "*$SubjectPattern*") {
    throw "The signer for $($file.Name) does not match '$SubjectPattern': $($signature.SignerCertificate.Subject)"
  }
  Write-Host "$($file.Name): $($signature.SignerCertificate.Subject)"
}
